/**
 * KnowledgeGraphDB.ts
 * 
 * SQLite-based knowledge graph database for JARVIS's brain.
 * Stores nodes (concepts, facts, entities) and edges (relationships)
 * with full-text search and graph traversal capabilities.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('KnowledgeGraphDB');

// ============================================================================
// Types
// ============================================================================

export type NodeType = 
  | 'fact'
  | 'preference'
  | 'entity'
  | 'concept'
  | 'memory'
  | 'knowledge'
  | 'skill'
  | 'person'
  | 'place'
  | 'event'
  | 'task'
  | 'self'; // JARVIS's own knowledge about itself

export type EdgeType =
  | 'related_to'
  | 'has_fact'
  | 'relates_to'
  | 'causes'
  | 'caused_by'
  | 'part_of'
  | 'contains'
  | 'before'
  | 'after'
  | 'similar_to'
  | 'opposite_of'
  | 'derived_from'
  | 'instance_of'
  | 'associated_with'
  | 'knows'
  | 'serves';

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  content: string;
  confidence: number;
  source: string;
  tags: string[];
  embedding?: number[];
  createdAt: number;
  accessedAt: number;
  modifiedAt: number;
  accessCount: number;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type: EdgeType;
  label?: string;
  weight: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface NodeInput {
  type: NodeType;
  label: string;
  content: string;
  confidence: number;
  source: string;
  tags?: string[];
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

export interface EdgeInput {
  sourceId: string;
  targetId: string;
  type: EdgeType;
  label?: string;
  weight?: number;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  query: string;
  limit?: number;
  minConfidence?: number;
  nodeTypes?: NodeType[];
  tags?: string[];
  includeRelated?: boolean;
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  nodesByType: Record<NodeType, number>;
  averageConfidence: number;
  lastModified: number;
}

// ============================================================================
// KnowledgeGraphDB Class
// ============================================================================

export class KnowledgeGraphDB extends EventEmitter {
  private db: Database.Database | null = null;
  private dbPath: string;
  private initialized: boolean = false;
  
  constructor(dbPath: string) {
    super();
    this.dbPath = dbPath;
  }
  
  // ==========================================================================
  // Initialization
  // ==========================================================================
  
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Open database
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    
    // Create tables
    this.createTables();
    
    // Create indexes
    this.createIndexes();
    
    this.initialized = true;
    logger.info(`Knowledge graph database initialized at ${this.dbPath}`);
  }
  
  private createTables(): void {
    if (!this.db) throw new Error('Database not initialized');
    
    // Nodes table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        content TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        source TEXT NOT NULL,
        tags TEXT DEFAULT '[]',
        embedding BLOB,
        created_at INTEGER NOT NULL,
        accessed_at INTEGER NOT NULL,
        modified_at INTEGER NOT NULL,
        access_count INTEGER DEFAULT 1,
        metadata TEXT DEFAULT '{}'
      )
    `);
    
    // Edges table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        type TEXT NOT NULL,
        label TEXT,
        weight REAL NOT NULL DEFAULT 0.5,
        metadata TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (source_id) REFERENCES nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES nodes(id) ON DELETE CASCADE
      )
    `);
    
    // Entities table (for quick entity lookup)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        name TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        type TEXT NOT NULL,
        aliases TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
      )
    `);
    
    // Associations table (for spreading activation)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS associations (
        id TEXT PRIMARY KEY,
        concept_a TEXT NOT NULL,
        concept_b TEXT NOT NULL,
        strength REAL NOT NULL DEFAULT 0.5,
        co_activations INTEGER DEFAULT 1,
        last_activated INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(concept_a, concept_b)
      )
    `);
    
    // Full-text search virtual table
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
        label,
        content,
        tags,
        content='nodes',
        content_rowid='rowid'
      )
    `);
    
    // Triggers to keep FTS in sync
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
        INSERT INTO nodes_fts(rowid, label, content, tags)
        VALUES (NEW.rowid, NEW.label, NEW.content, NEW.tags);
      END
    `);
    
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
        INSERT INTO nodes_fts(nodes_fts, rowid, label, content, tags)
        VALUES ('delete', OLD.rowid, OLD.label, OLD.content, OLD.tags);
      END
    `);
    
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
        INSERT INTO nodes_fts(nodes_fts, rowid, label, content, tags)
        VALUES ('delete', OLD.rowid, OLD.label, OLD.content, OLD.tags);
        INSERT INTO nodes_fts(rowid, label, content, tags)
        VALUES (NEW.rowid, NEW.label, NEW.content, NEW.tags);
      END
    `);
  }
  
  private createIndexes(): void {
    if (!this.db) throw new Error('Database not initialized');
    
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_confidence ON nodes(confidence)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_accessed ON nodes(accessed_at)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_associations_concepts ON associations(concept_a, concept_b)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_associations_strength ON associations(strength DESC)`);
  }
  
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }
  
  // ==========================================================================
  // Node Operations
  // ==========================================================================
  
  async addNode(input: NodeInput): Promise<string> {
    if (!this.db) throw new Error('Database not initialized');
    
    const id = this.generateId();
    const now = Date.now();
    
    const stmt = this.db.prepare(`
      INSERT INTO nodes (id, type, label, content, confidence, source, tags, embedding, created_at, accessed_at, modified_at, access_count, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      input.type,
      input.label,
      input.content,
      input.confidence,
      input.source,
      JSON.stringify(input.tags || []),
      input.embedding ? Buffer.from(new Float32Array(input.embedding).buffer) : null,
      now,
      now,
      now,
      1,
      JSON.stringify(input.metadata || {})
    );
    
    this.emit('node_added', { id, type: input.type, label: input.label });
    return id;
  }
  
  async getNode(id: string): Promise<GraphNode | null> {
    if (!this.db) throw new Error('Database not initialized');
    
    const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    
    // Update access time and count
    this.db.prepare('UPDATE nodes SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?')
      .run(Date.now(), id);
    
    return this.rowToNode(row);
  }
  
  async updateNode(id: string, updates: Partial<NodeInput & { accessedAt?: number }>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const sets: string[] = [];
    const values: unknown[] = [];
    
    if (updates.type !== undefined) { sets.push('type = ?'); values.push(updates.type); }
    if (updates.label !== undefined) { sets.push('label = ?'); values.push(updates.label); }
    if (updates.content !== undefined) { sets.push('content = ?'); values.push(updates.content); }
    if (updates.confidence !== undefined) { sets.push('confidence = ?'); values.push(updates.confidence); }
    if (updates.source !== undefined) { sets.push('source = ?'); values.push(updates.source); }
    if (updates.tags !== undefined) { sets.push('tags = ?'); values.push(JSON.stringify(updates.tags)); }
    if (updates.metadata !== undefined) { sets.push('metadata = ?'); values.push(JSON.stringify(updates.metadata)); }
    if (updates.accessedAt !== undefined) { sets.push('accessed_at = ?'); values.push(updates.accessedAt); }
    
    sets.push('modified_at = ?');
    values.push(Date.now());
    values.push(id);
    
    if (sets.length > 1) {
      this.db.prepare(`UPDATE nodes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }
  }
  
  async deleteNode(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
    this.emit('node_deleted', { id });
  }
  
  async findNode(subject: string, predicate: string, object: string): Promise<GraphNode | null> {
    if (!this.db) throw new Error('Database not initialized');
    
    const searchContent = JSON.stringify({ subject, predicate, object });
    const row = this.db.prepare('SELECT * FROM nodes WHERE content = ?').get(searchContent) as Record<string, unknown> | undefined;
    
    return row ? this.rowToNode(row) : null;
  }
  
  async findBySubjectPredicate(subject: string, predicate: string): Promise<GraphNode[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const rows = this.db.prepare(`
      SELECT * FROM nodes 
      WHERE content LIKE ? AND content LIKE ?
    `).all(`%"subject":"${subject}"%`, `%"predicate":"${predicate}"%`) as Record<string, unknown>[];
    
    return rows.map(row => this.rowToNode(row));
  }
  
  // ==========================================================================
  // Edge Operations
  // ==========================================================================
  
  async addEdge(input: EdgeInput): Promise<string> {
    if (!this.db) throw new Error('Database not initialized');
    
    const id = this.generateId();
    const now = Date.now();
    
    const stmt = this.db.prepare(`
      INSERT INTO edges (id, source_id, target_id, type, label, weight, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      input.sourceId,
      input.targetId,
      input.type,
      input.label || null,
      input.weight || 0.5,
      JSON.stringify(input.metadata || {}),
      now
    );
    
    this.emit('edge_added', { id, sourceId: input.sourceId, targetId: input.targetId, type: input.type });
    return id;
  }
  
  async getEdge(id: string): Promise<GraphEdge | null> {
    if (!this.db) throw new Error('Database not initialized');
    
    const row = this.db.prepare('SELECT * FROM edges WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToEdge(row) : null;
  }
  
  async getEdgesFrom(nodeId: string): Promise<GraphEdge[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const rows = this.db.prepare('SELECT * FROM edges WHERE source_id = ?').all(nodeId) as Record<string, unknown>[];
    return rows.map(row => this.rowToEdge(row));
  }
  
  async getEdgesTo(nodeId: string): Promise<GraphEdge[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const rows = this.db.prepare('SELECT * FROM edges WHERE target_id = ?').all(nodeId) as Record<string, unknown>[];
    return rows.map(row => this.rowToEdge(row));
  }
  
  async updateEdgeWeight(id: string, weight: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.prepare('UPDATE edges SET weight = ? WHERE id = ?').run(weight, id);
  }
  
  async deleteEdge(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.prepare('DELETE FROM edges WHERE id = ?').run(id);
  }
  
  // ==========================================================================
  // Entity Operations
  // ==========================================================================
  
  async findOrCreateEntity(name: string, type: NodeType = 'entity'): Promise<GraphNode> {
    if (!this.db) throw new Error('Database not initialized');
    
    const normalizedName = name.toLowerCase().trim();
    
    // Check if entity exists
    const existing = this.db.prepare('SELECT node_id FROM entities WHERE name = ?').get(normalizedName) as { node_id: string } | undefined;
    
    if (existing) {
      const node = await this.getNode(existing.node_id);
      if (node) return node;
    }
    
    // Create new entity
    const nodeId = await this.addNode({
      type,
      label: name,
      content: JSON.stringify({ name: normalizedName, type }),
      confidence: 0.5,
      source: 'entity_creation',
      tags: ['entity', type],
    });
    
    this.db.prepare(`
      INSERT INTO entities (name, node_id, type, aliases, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(normalizedName, nodeId, type, '[]', Date.now());
    
    return (await this.getNode(nodeId))!;
  }
  
  async addEntityAlias(name: string, alias: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const entity = this.db.prepare('SELECT aliases FROM entities WHERE name = ?').get(name.toLowerCase()) as { aliases: string } | undefined;
    if (!entity) return;
    
    const aliases = JSON.parse(entity.aliases) as string[];
    if (!aliases.includes(alias.toLowerCase())) {
      aliases.push(alias.toLowerCase());
      this.db.prepare('UPDATE entities SET aliases = ? WHERE name = ?').run(JSON.stringify(aliases), name.toLowerCase());
    }
  }
  
  // ==========================================================================
  // Search Operations
  // ==========================================================================
  
  async search(options: SearchOptions): Promise<GraphNode[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const { query, limit = 20, minConfidence = 0, nodeTypes, tags } = options;
    
    // Try FTS search first
    try {
      let sql = `
        SELECT nodes.* FROM nodes
        JOIN nodes_fts ON nodes.rowid = nodes_fts.rowid
        WHERE nodes_fts MATCH ?
        AND nodes.confidence >= ?
      `;
      const params: unknown[] = [this.prepareFtsQuery(query), minConfidence];
      
      if (nodeTypes && nodeTypes.length > 0) {
        sql += ` AND nodes.type IN (${nodeTypes.map(() => '?').join(',')})`;
        params.push(...nodeTypes);
      }
      
      sql += ` ORDER BY rank LIMIT ?`;
      params.push(limit);
      
      const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
      
      // Filter by tags if specified
      let results = rows.map(row => this.rowToNode(row));
      if (tags && tags.length > 0) {
        results = results.filter(node => tags.some(tag => node.tags.includes(tag)));
      }
      
      return results;
    } catch {
      // Fallback to LIKE search if FTS fails
      let sql = `SELECT * FROM nodes WHERE (label LIKE ? OR content LIKE ?) AND confidence >= ?`;
      const likeQuery = `%${query}%`;
      const params: unknown[] = [likeQuery, likeQuery, minConfidence];
      
      if (nodeTypes && nodeTypes.length > 0) {
        sql += ` AND type IN (${nodeTypes.map(() => '?').join(',')})`;
        params.push(...nodeTypes);
      }
      
      sql += ` ORDER BY confidence DESC LIMIT ?`;
      params.push(limit);
      
      const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
      return rows.map(row => this.rowToNode(row));
    }
  }
  
  private prepareFtsQuery(query: string): string {
    // Escape special FTS characters and prepare for prefix matching
    const escaped = query.replace(/['"*()]/g, '');
    const terms = escaped.split(/\s+/).filter(t => t.length > 0);
    return terms.map(t => `"${t}"*`).join(' OR ');
  }
  
  // ==========================================================================
  // Graph Traversal
  // ==========================================================================
  
  async getRelatedNodes(nodeId: string, depth: number = 1): Promise<GraphNode[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const visited = new Set<string>();
    const result: GraphNode[] = [];
    
    const traverse = async (currentId: string, currentDepth: number): Promise<void> => {
      if (currentDepth > depth || visited.has(currentId)) return;
      visited.add(currentId);
      
      // Get outgoing edges
      const outgoing = await this.getEdgesFrom(currentId);
      for (const edge of outgoing) {
        if (!visited.has(edge.targetId)) {
          const node = await this.getNode(edge.targetId);
          if (node) {
            result.push(node);
            await traverse(edge.targetId, currentDepth + 1);
          }
        }
      }
      
      // Get incoming edges
      const incoming = await this.getEdgesTo(currentId);
      for (const edge of incoming) {
        if (!visited.has(edge.sourceId)) {
          const node = await this.getNode(edge.sourceId);
          if (node) {
            result.push(node);
            await traverse(edge.sourceId, currentDepth + 1);
          }
        }
      }
    };
    
    await traverse(nodeId, 0);
    return result;
  }
  
  async findPath(fromId: string, toId: string, maxDepth: number = 5): Promise<GraphNode[] | null> {
    if (!this.db) throw new Error('Database not initialized');
    
    // BFS to find shortest path
    const queue: Array<{ nodeId: string; path: string[] }> = [{ nodeId: fromId, path: [fromId] }];
    const visited = new Set<string>();
    
    while (queue.length > 0) {
      const { nodeId, path } = queue.shift()!;
      
      if (nodeId === toId) {
        // Found path - retrieve nodes
        const nodes: GraphNode[] = [];
        for (const id of path) {
          const node = await this.getNode(id);
          if (node) nodes.push(node);
        }
        return nodes;
      }
      
      if (path.length >= maxDepth) continue;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      
      const edges = [...await this.getEdgesFrom(nodeId), ...await this.getEdgesTo(nodeId)];
      for (const edge of edges) {
        const nextId = edge.sourceId === nodeId ? edge.targetId : edge.sourceId;
        if (!visited.has(nextId)) {
          queue.push({ nodeId: nextId, path: [...path, nextId] });
        }
      }
    }
    
    return null; // No path found
  }
  
  // ==========================================================================
  // Maintenance Operations
  // ==========================================================================
  
  async applyDecay(decayRate: number): Promise<{ affected: number }> {
    if (!this.db) throw new Error('Database not initialized');
    
    // Calculate days since last access for decay
    const now = Date.now();
    const result = this.db.prepare(`
      UPDATE nodes 
      SET confidence = confidence * (1.0 - ? * ((? - accessed_at) / 86400000.0))
      WHERE accessed_at < ?
      AND confidence > 0.1
    `).run(decayRate, now, now - 86400000);
    
    return { affected: result.changes };
  }
  
  async pruneWeak(minConfidence: number): Promise<{ pruned: number }> {
    if (!this.db) throw new Error('Database not initialized');
    
    // Get IDs to prune (don't prune entities, people, or user/self-related facts)
    const toPrune = this.db.prepare(`
      SELECT id FROM nodes 
      WHERE confidence < ? 
      AND type NOT IN ('entity', 'person', 'self')
      AND tags NOT LIKE '%user_knowledge%'
      AND tags NOT LIKE '%core_identity%'
    `).all(minConfidence) as { id: string }[];
    
    for (const { id } of toPrune) {
      await this.deleteNode(id);
    }
    
    return { pruned: toPrune.length };
  }
  
  async findDecayedImportant(): Promise<GraphNode[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const rows = this.db.prepare(`
      SELECT * FROM nodes
      WHERE confidence > 0.6
      AND accessed_at < ?
      ORDER BY confidence DESC
      LIMIT 10
    `).all(Date.now() - 604800000) as Record<string, unknown>[]; // 7 days
    
    return rows.map(row => this.rowToNode(row));
  }
  
  // ==========================================================================
  // Statistics
  // ==========================================================================
  
  async getStats(): Promise<GraphStats> {
    if (!this.db) throw new Error('Database not initialized');
    
    const nodeCount = (this.db.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number }).count;
    const edgeCount = (this.db.prepare('SELECT COUNT(*) as count FROM edges').get() as { count: number }).count;
    
    const typeRows = this.db.prepare('SELECT type, COUNT(*) as count FROM nodes GROUP BY type').all() as { type: NodeType; count: number }[];
    const nodesByType: Record<NodeType, number> = {} as Record<NodeType, number>;
    for (const row of typeRows) {
      nodesByType[row.type] = row.count;
    }
    
    const avgConfidence = (this.db.prepare('SELECT AVG(confidence) as avg FROM nodes').get() as { avg: number | null }).avg || 0;
    const lastModified = (this.db.prepare('SELECT MAX(modified_at) as max FROM nodes').get() as { max: number | null }).max || 0;
    
    return {
      nodeCount,
      edgeCount,
      nodesByType,
      averageConfidence: avgConfidence,
      lastModified,
    };
  }
  
  async getFullGraph(options?: {
    limit?: number;
    minConfidence?: number;
    nodeTypes?: NodeType[];
  }): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    if (!this.db) throw new Error('Database not initialized');
    
    const { limit = 500, minConfidence = 0.1, nodeTypes } = options || {};
    
    let nodeSql = 'SELECT * FROM nodes WHERE confidence >= ?';
    const nodeParams: unknown[] = [minConfidence];
    
    if (nodeTypes && nodeTypes.length > 0) {
      nodeSql += ` AND type IN (${nodeTypes.map(() => '?').join(',')})`;
      nodeParams.push(...nodeTypes);
    }
    
    nodeSql += ' ORDER BY confidence DESC, accessed_at DESC LIMIT ?';
    nodeParams.push(limit);
    
    const nodeRows = this.db.prepare(nodeSql).all(...nodeParams) as Record<string, unknown>[];
    const nodes = nodeRows.map(row => this.rowToNode(row));
    const nodeIds = new Set(nodes.map(n => n.id));
    
    // Get edges between these nodes
    if (nodeIds.size === 0) {
      return { nodes, edges: [] };
    }
    
    const nodeIdArray = Array.from(nodeIds);
    const edgeRows = this.db.prepare(`
      SELECT * FROM edges 
      WHERE source_id IN (${nodeIdArray.map(() => '?').join(',')})
      AND target_id IN (${nodeIdArray.map(() => '?').join(',')})
    `).all(...nodeIdArray, ...nodeIdArray) as Record<string, unknown>[];
    
    const edges = edgeRows.map(row => this.rowToEdge(row));
    
    return { nodes, edges };
  }
  
  // ==========================================================================
  // Association Operations
  // ==========================================================================
  
  async getAssociation(conceptA: string, conceptB: string): Promise<{ strength: number; coActivations: number } | null> {
    if (!this.db) throw new Error('Database not initialized');
    
    const [a, b] = [conceptA.toLowerCase(), conceptB.toLowerCase()].sort();
    const row = this.db.prepare(`
      SELECT strength, co_activations FROM associations
      WHERE concept_a = ? AND concept_b = ?
    `).get(a, b) as { strength: number; co_activations: number } | undefined;
    
    return row ? { strength: row.strength, coActivations: row.co_activations } : null;
  }
  
  async setAssociation(conceptA: string, conceptB: string, strength: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const [a, b] = [conceptA.toLowerCase(), conceptB.toLowerCase()].sort();
    const now = Date.now();
    
    this.db.prepare(`
      INSERT INTO associations (id, concept_a, concept_b, strength, co_activations, last_activated, created_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(concept_a, concept_b) DO UPDATE SET
        strength = ?,
        co_activations = co_activations + 1,
        last_activated = ?
    `).run(this.generateId(), a, b, strength, now, now, strength, now);
  }
  
  async getAssociationsFor(concept: string, limit: number = 20): Promise<Array<{ concept: string; strength: number }>> {
    if (!this.db) throw new Error('Database not initialized');
    
    const lowerConcept = concept.toLowerCase();
    const rows = this.db.prepare(`
      SELECT 
        CASE WHEN concept_a = ? THEN concept_b ELSE concept_a END as concept,
        strength
      FROM associations
      WHERE concept_a = ? OR concept_b = ?
      ORDER BY strength DESC
      LIMIT ?
    `).all(lowerConcept, lowerConcept, lowerConcept, limit) as { concept: string; strength: number }[];
    
    return rows;
  }
  
  async getStrongestAssociations(limit: number = 10): Promise<Array<{ conceptA: string; conceptB: string; strength: number }>> {
    if (!this.db) throw new Error('Database not initialized');
    
    const rows = this.db.prepare(`
      SELECT concept_a, concept_b, strength
      FROM associations
      ORDER BY strength DESC
      LIMIT ?
    `).all(limit) as { concept_a: string; concept_b: string; strength: number }[];
    
    return rows.map(r => ({ conceptA: r.concept_a, conceptB: r.concept_b, strength: r.strength }));
  }
  
  async decayAssociations(decayRate: number): Promise<{ affected: number }> {
    if (!this.db) throw new Error('Database not initialized');
    
    const result = this.db.prepare(`
      UPDATE associations
      SET strength = strength * (1 - ?)
      WHERE last_activated < ?
    `).run(decayRate, Date.now() - 86400000);
    
    // Prune very weak associations
    this.db.prepare('DELETE FROM associations WHERE strength < 0.05').run();
    
    return { affected: result.changes };
  }
  
  // ==========================================================================
  // Helpers
  // ==========================================================================
  
  private generateId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  private rowToNode(row: Record<string, unknown>): GraphNode {
    return {
      id: row.id as string,
      type: row.type as NodeType,
      label: row.label as string,
      content: row.content as string,
      confidence: row.confidence as number,
      source: row.source as string,
      tags: JSON.parse(row.tags as string || '[]'),
      embedding: row.embedding ? Array.from(new Float32Array((row.embedding as Buffer).buffer)) : undefined,
      createdAt: row.created_at as number,
      accessedAt: row.accessed_at as number,
      modifiedAt: row.modified_at as number,
      accessCount: row.access_count as number,
      metadata: JSON.parse(row.metadata as string || '{}'),
    };
  }
  
  private rowToEdge(row: Record<string, unknown>): GraphEdge {
    return {
      id: row.id as string,
      sourceId: row.source_id as string,
      targetId: row.target_id as string,
      type: row.type as EdgeType,
      label: row.label as string | undefined,
      weight: row.weight as number,
      metadata: JSON.parse(row.metadata as string || '{}'),
      createdAt: row.created_at as number,
    };
  }
}

export default KnowledgeGraphDB;
