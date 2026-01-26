/**
 * Ontology Store - Core data storage for the Intelligence Platform
 * Uses SQLite for entity/relationship storage with vector support via LanceDB
 */

import Database from 'better-sqlite3';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import {
  OntologyEntity,
  OntologyRelationship,
  EntityType,
  RelationshipType,
  SourceRecord,
  QueryResult,
  SearchResult,
  PaginationOptions,
  SortOptions,
} from '../types';

const logger = createModuleLogger('OntologyStore');

// ============================================================================
// TYPES
// ============================================================================

export interface OntologyStoreConfig {
  dbPath?: string;
  enableWAL?: boolean;
  cacheSize?: number;
}

export interface EntityFilter {
  type?: EntityType;
  ids?: string[];
  createdAfter?: Date;
  updatedAfter?: Date;
  search?: string;
}

export interface RelationshipFilter {
  sourceId?: string;
  targetId?: string;
  type?: RelationshipType;
  direction?: 'incoming' | 'outgoing' | 'both';
}

export interface OntologyStatistics {
  entityCounts: Record<EntityType, number>;
  relationshipCounts: Record<RelationshipType, number>;
  totalEntities: number;
  totalRelationships: number;
  lastUpdated: Date;
  dbSizeBytes: number;
}

// ============================================================================
// SQL SCHEMA
// ============================================================================

const SCHEMA_SQL = `
-- Core entities table
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data JSON NOT NULL,
  embedding BLOB,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  confidence REAL DEFAULT 1.0
);

CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_updated ON entities(updated_at);
CREATE INDEX IF NOT EXISTS idx_entities_created ON entities(created_at);

-- Relationships table
CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  properties JSON,
  start_date INTEGER,
  end_date INTEGER,
  strength REAL DEFAULT 1.0,
  confidence REAL DEFAULT 1.0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  
  FOREIGN KEY (source_id) REFERENCES entities(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_id);
CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_id);
CREATE INDEX IF NOT EXISTS idx_rel_type ON relationships(relationship_type);
CREATE INDEX IF NOT EXISTS idx_rel_source_type ON relationships(source_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_rel_target_type ON relationships(target_id, relationship_type);

-- Source records (provenance)
CREATE TABLE IF NOT EXISTS source_records (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  raw_data JSON,
  extracted_at INTEGER NOT NULL,
  confidence REAL DEFAULT 1.0,
  
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_entity ON source_records(entity_id);
CREATE INDEX IF NOT EXISTS idx_source_type ON source_records(source_type);

-- Full-text search virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
  id,
  type,
  searchable_text,
  content='entities',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
  INSERT INTO entities_fts(rowid, id, type, searchable_text) 
  VALUES (NEW.rowid, NEW.id, NEW.type, json_extract(NEW.data, '$.name') || ' ' || COALESCE(json_extract(NEW.data, '$.title'), '') || ' ' || COALESCE(json_extract(NEW.data, '$.description'), '') || ' ' || COALESCE(json_extract(NEW.data, '$.canonicalName'), ''));
END;

CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, id, type, searchable_text) 
  VALUES('delete', OLD.rowid, OLD.id, OLD.type, json_extract(OLD.data, '$.name') || ' ' || COALESCE(json_extract(OLD.data, '$.title'), '') || ' ' || COALESCE(json_extract(OLD.data, '$.description'), '') || ' ' || COALESCE(json_extract(OLD.data, '$.canonicalName'), ''));
END;

CREATE TRIGGER IF NOT EXISTS entities_au AFTER UPDATE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, id, type, searchable_text) 
  VALUES('delete', OLD.rowid, OLD.id, OLD.type, json_extract(OLD.data, '$.name') || ' ' || COALESCE(json_extract(OLD.data, '$.title'), '') || ' ' || COALESCE(json_extract(OLD.data, '$.description'), '') || ' ' || COALESCE(json_extract(OLD.data, '$.canonicalName'), ''));
  INSERT INTO entities_fts(rowid, id, type, searchable_text) 
  VALUES (NEW.rowid, NEW.id, NEW.type, json_extract(NEW.data, '$.name') || ' ' || COALESCE(json_extract(NEW.data, '$.title'), '') || ' ' || COALESCE(json_extract(NEW.data, '$.description'), '') || ' ' || COALESCE(json_extract(NEW.data, '$.canonicalName'), ''));
END;

-- Audit log table
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  reason TEXT,
  query_text TEXT,
  success INTEGER NOT NULL,
  error_message TEXT,
  fields_accessed JSON,
  sensitive_data_accessed INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_id);

-- Decision log table
CREATE TABLE IF NOT EXISTS decision_log (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  agent_name TEXT NOT NULL,
  query_text TEXT,
  context JSON,
  decision_type TEXT NOT NULL,
  chosen_action JSON NOT NULL,
  alternative_actions JSON,
  reasoning TEXT,
  confidence REAL,
  outcome JSON,
  user_feedback JSON,
  lessons_learned JSON
);

CREATE INDEX IF NOT EXISTS idx_decision_agent ON decision_log(agent_name);
CREATE INDEX IF NOT EXISTS idx_decision_timestamp ON decision_log(timestamp);

-- Playbook runs table
CREATE TABLE IF NOT EXISTS playbook_runs (
  id TEXT PRIMARY KEY,
  playbook_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT NOT NULL,
  trigger_data JSON,
  step_results JSON,
  final_outcome JSON,
  user_feedback JSON
);

CREATE INDEX IF NOT EXISTS idx_playbook_runs_playbook ON playbook_runs(playbook_id);
CREATE INDEX IF NOT EXISTS idx_playbook_runs_status ON playbook_runs(status);

-- Playbooks table
CREATE TABLE IF NOT EXISTS playbooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  domain TEXT NOT NULL,
  trigger JSON NOT NULL,
  steps JSON NOT NULL,
  requires_approval INTEGER DEFAULT 0,
  approval_prompt TEXT,
  feedback_enabled INTEGER DEFAULT 1,
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  run_count INTEGER DEFAULT 0,
  success_rate REAL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_playbooks_domain ON playbooks(domain);
CREATE INDEX IF NOT EXISTS idx_playbooks_enabled ON playbooks(enabled);

-- Anomaly patterns table
CREATE TABLE IF NOT EXISTS anomaly_patterns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  field TEXT NOT NULL,
  method TEXT NOT NULL,
  threshold REAL NOT NULL,
  baseline_window TEXT NOT NULL,
  minimum_data_points INTEGER NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- Detected anomalies table
CREATE TABLE IF NOT EXISTS anomalies (
  id TEXT PRIMARY KEY,
  pattern_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  observed_value TEXT,
  expected_value TEXT,
  deviation_score REAL NOT NULL,
  detected_at INTEGER NOT NULL,
  severity TEXT NOT NULL,
  acknowledged INTEGER DEFAULT 0,
  
  FOREIGN KEY (pattern_id) REFERENCES anomaly_patterns(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_anomalies_entity ON anomalies(entity_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_severity ON anomalies(severity);
`;

// ============================================================================
// ONTOLOGY STORE CLASS
// ============================================================================

export class OntologyStore extends EventEmitter {
  private db: Database.Database | null = null;
  private config: OntologyStoreConfig;
  private initialized = false;

  constructor(config: OntologyStoreConfig = {}) {
    super();
    this.config = {
      dbPath: config.dbPath || path.join(app.getPath('userData'), 'intelligence', 'ontology.db'),
      enableWAL: config.enableWAL ?? true,
      cacheSize: config.cacheSize ?? 256, // MB
    };
  }

  // --------------------------------------------------------------------------
  // INITIALIZATION
  // --------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure directory exists
      const dbDir = path.dirname(this.config.dbPath!);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Open database
      this.db = new Database(this.config.dbPath!);

      // Configure SQLite
      if (this.config.enableWAL) {
        this.db.pragma('journal_mode = WAL');
      }
      this.db.pragma(`cache_size = -${this.config.cacheSize! * 1024}`); // Negative = KB
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('synchronous = NORMAL');

      // Create schema
      this.db.exec(SCHEMA_SQL);

      this.initialized = true;
      logger.info('OntologyStore initialized', { dbPath: this.config.dbPath });
    } catch (error) {
      logger.error('Failed to initialize OntologyStore', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
      logger.info('OntologyStore closed');
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new Error('OntologyStore not initialized. Call initialize() first.');
    }
  }

  // --------------------------------------------------------------------------
  // ENTITY OPERATIONS
  // --------------------------------------------------------------------------

  async createEntity<T extends OntologyEntity>(entity: T): Promise<T> {
    this.ensureInitialized();

    const now = Date.now();
    const stmt = this.db!.prepare(`
      INSERT INTO entities (id, type, data, created_at, updated_at, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(
        entity.id,
        entity.type,
        JSON.stringify(entity),
        now,
        now,
        entity.confidence ?? 1.0
      );

      // Store source records
      if (entity.sourceRecords?.length) {
        await this.storeSourceRecords(entity.id, entity.sourceRecords);
      }

      this.emit('entity:created', entity);
      logger.debug('Entity created', { id: entity.id, type: entity.type });

      return entity;
    } catch (error) {
      logger.error('Failed to create entity', { id: entity.id, error });
      throw error;
    }
  }

  async getEntity<T extends OntologyEntity>(id: string): Promise<T | null> {
    this.ensureInitialized();

    const stmt = this.db!.prepare('SELECT data FROM entities WHERE id = ?');
    const row = stmt.get(id) as { data: string } | undefined;

    if (!row) return null;

    const entity = JSON.parse(row.data) as T;
    return this.hydrateDates(entity);
  }

  async getEntities<T extends OntologyEntity>(
    filter: EntityFilter = {},
    pagination?: PaginationOptions,
    sort?: SortOptions
  ): Promise<T[]> {
    this.ensureInitialized();

    let query = 'SELECT data FROM entities WHERE 1=1';
    const params: unknown[] = [];

    if (filter.type) {
      query += ' AND type = ?';
      params.push(filter.type);
    }

    if (filter.ids?.length) {
      query += ` AND id IN (${filter.ids.map(() => '?').join(',')})`;
      params.push(...filter.ids);
    }

    if (filter.createdAfter) {
      query += ' AND created_at > ?';
      params.push(filter.createdAfter.getTime());
    }

    if (filter.updatedAfter) {
      query += ' AND updated_at > ?';
      params.push(filter.updatedAfter.getTime());
    }

    if (sort) {
      // Map common fields
      const fieldMap: Record<string, string> = {
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        confidence: 'confidence',
      };
      const dbField = fieldMap[sort.field] || `json_extract(data, '$.${sort.field}')`;
      query += ` ORDER BY ${dbField} ${sort.direction.toUpperCase()}`;
    }

    if (pagination) {
      query += ' LIMIT ? OFFSET ?';
      params.push(pagination.limit, pagination.offset);
    }

    const stmt = this.db!.prepare(query);
    const rows = stmt.all(...params) as { data: string }[];

    return rows.map(row => this.hydrateDates(JSON.parse(row.data) as T));
  }

  async updateEntity<T extends OntologyEntity>(
    id: string,
    updates: Partial<T>
  ): Promise<T | null> {
    this.ensureInitialized();

    const existing = await this.getEntity<T>(id);
    if (!existing) return null;

    const updated = { ...existing, ...updates, updatedAt: new Date() };
    const now = Date.now();

    const stmt = this.db!.prepare(`
      UPDATE entities SET data = ?, updated_at = ?, confidence = ?
      WHERE id = ?
    `);

    stmt.run(JSON.stringify(updated), now, updated.confidence ?? 1.0, id);

    this.emit('entity:updated', updated);
    logger.debug('Entity updated', { id, type: existing.type });

    return updated;
  }

  async deleteEntity(id: string): Promise<boolean> {
    this.ensureInitialized();

    const existing = await this.getEntity(id);
    if (!existing) return false;

    const stmt = this.db!.prepare('DELETE FROM entities WHERE id = ?');
    const result = stmt.run(id);

    if (result.changes > 0) {
      this.emit('entity:deleted', { id, type: existing.type });
      logger.debug('Entity deleted', { id, type: existing.type });
      return true;
    }

    return false;
  }

  async bulkCreateEntities(entities: OntologyEntity[]): Promise<number> {
    this.ensureInitialized();

    const now = Date.now();
    const stmt = this.db!.prepare(`
      INSERT OR REPLACE INTO entities (id, type, data, created_at, updated_at, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db!.transaction((items: OntologyEntity[]) => {
      let count = 0;
      for (const entity of items) {
        stmt.run(
          entity.id,
          entity.type,
          JSON.stringify(entity),
          now,
          now,
          entity.confidence ?? 1.0
        );
        count++;
      }
      return count;
    });

    const count = transaction(entities);
    logger.info('Bulk created entities', { count });
    this.emit('entities:bulk-created', { count });

    return count;
  }

  // --------------------------------------------------------------------------
  // RELATIONSHIP OPERATIONS
  // --------------------------------------------------------------------------

  async createRelationship(rel: OntologyRelationship): Promise<OntologyRelationship> {
    this.ensureInitialized();

    const now = Date.now();
    const stmt = this.db!.prepare(`
      INSERT INTO relationships (
        id, source_id, source_type, target_id, target_type, relationship_type,
        properties, start_date, end_date, strength, confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      rel.id,
      rel.sourceId,
      rel.sourceType,
      rel.targetId,
      rel.targetType,
      rel.relationshipType,
      JSON.stringify(rel.properties || {}),
      rel.startDate?.getTime() || null,
      rel.endDate?.getTime() || null,
      rel.strength ?? 1.0,
      rel.confidence ?? 1.0,
      now,
      now
    );

    this.emit('relationship:created', rel);
    logger.debug('Relationship created', {
      id: rel.id,
      type: rel.relationshipType,
      source: rel.sourceId,
      target: rel.targetId,
    });

    return rel;
  }

  async getRelationships(
    entityId: string,
    direction: 'incoming' | 'outgoing' | 'both' = 'both'
  ): Promise<OntologyRelationship[]> {
    this.ensureInitialized();

    let query: string;
    const params: string[] = [];

    if (direction === 'outgoing') {
      query = 'SELECT * FROM relationships WHERE source_id = ?';
      params.push(entityId);
    } else if (direction === 'incoming') {
      query = 'SELECT * FROM relationships WHERE target_id = ?';
      params.push(entityId);
    } else {
      query = 'SELECT * FROM relationships WHERE source_id = ? OR target_id = ?';
      params.push(entityId, entityId);
    }

    const stmt = this.db!.prepare(query);
    const rows = stmt.all(...params) as RelationshipRow[];

    return rows.map(this.rowToRelationship);
  }

  async getRelationshipsByType(type: RelationshipType): Promise<OntologyRelationship[]> {
    this.ensureInitialized();

    const stmt = this.db!.prepare('SELECT * FROM relationships WHERE relationship_type = ?');
    const rows = stmt.all(type) as RelationshipRow[];

    return rows.map(this.rowToRelationship);
  }

  async deleteRelationship(id: string): Promise<boolean> {
    this.ensureInitialized();

    const stmt = this.db!.prepare('DELETE FROM relationships WHERE id = ?');
    const result = stmt.run(id);

    if (result.changes > 0) {
      this.emit('relationship:deleted', { id });
      return true;
    }

    return false;
  }

  async bulkCreateRelationships(relationships: OntologyRelationship[]): Promise<number> {
    this.ensureInitialized();

    const now = Date.now();
    const stmt = this.db!.prepare(`
      INSERT OR REPLACE INTO relationships (
        id, source_id, source_type, target_id, target_type, relationship_type,
        properties, start_date, end_date, strength, confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db!.transaction((items: OntologyRelationship[]) => {
      let count = 0;
      for (const rel of items) {
        stmt.run(
          rel.id,
          rel.sourceId,
          rel.sourceType,
          rel.targetId,
          rel.targetType,
          rel.relationshipType,
          JSON.stringify(rel.properties || {}),
          rel.startDate?.getTime() || null,
          rel.endDate?.getTime() || null,
          rel.strength ?? 1.0,
          rel.confidence ?? 1.0,
          now,
          now
        );
        count++;
      }
      return count;
    });

    const count = transaction(relationships);
    logger.info('Bulk created relationships', { count });

    return count;
  }

  // --------------------------------------------------------------------------
  // SEARCH OPERATIONS
  // --------------------------------------------------------------------------

  async searchByText(
    text: string,
    entityTypes?: EntityType[],
    limit = 20
  ): Promise<SearchResult[]> {
    this.ensureInitialized();

    let query = `
      SELECT e.data, f.rank
      FROM entities_fts f
      JOIN entities e ON e.id = f.id
      WHERE entities_fts MATCH ?
    `;
    const params: unknown[] = [text];

    if (entityTypes?.length) {
      query += ` AND e.type IN (${entityTypes.map(() => '?').join(',')})`;
      params.push(...entityTypes);
    }

    query += ' ORDER BY f.rank LIMIT ?';
    params.push(limit);

    const stmt = this.db!.prepare(query);
    const rows = stmt.all(...params) as { data: string; rank: number }[];

    return rows.map(row => ({
      entity: this.hydrateDates(JSON.parse(row.data)),
      score: -row.rank, // FTS5 rank is negative, lower is better
      highlights: [], // TODO: Extract highlights
    }));
  }

  // --------------------------------------------------------------------------
  // QUERY OPERATIONS
  // --------------------------------------------------------------------------

  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    this.ensureInitialized();

    const start = Date.now();

    try {
      const stmt = this.db!.prepare(sql);
      const rows = stmt.all(...params) as Record<string, unknown>[];

      return {
        rows,
        columns: rows.length > 0 ? Object.keys(rows[0]) : [],
        rowCount: rows.length,
        executionTime: Date.now() - start,
      };
    } catch (error) {
      logger.error('Query failed', { sql, error });
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // GRAPH TRAVERSAL
  // --------------------------------------------------------------------------

  async getNeighbors(
    entityId: string,
    depth = 1,
    relationshipTypes?: RelationshipType[]
  ): Promise<{
    nodes: OntologyEntity[];
    edges: OntologyRelationship[];
  }> {
    this.ensureInitialized();

    const visitedNodes = new Set<string>();
    const visitedEdges = new Set<string>();
    const nodes: OntologyEntity[] = [];
    const edges: OntologyRelationship[] = [];

    const traverse = async (currentId: string, currentDepth: number) => {
      if (currentDepth > depth || visitedNodes.has(currentId)) return;

      visitedNodes.add(currentId);
      const entity = await this.getEntity(currentId);
      if (entity) nodes.push(entity);

      const rels = await this.getRelationships(currentId, 'both');
      for (const rel of rels) {
        if (relationshipTypes && !relationshipTypes.includes(rel.relationshipType)) {
          continue;
        }

        if (!visitedEdges.has(rel.id)) {
          visitedEdges.add(rel.id);
          edges.push(rel);

          const neighborId = rel.sourceId === currentId ? rel.targetId : rel.sourceId;
          await traverse(neighborId, currentDepth + 1);
        }
      }
    };

    await traverse(entityId, 0);

    return { nodes, edges };
  }

  async findPath(
    fromId: string,
    toId: string,
    maxHops = 5
  ): Promise<{
    found: boolean;
    path: OntologyEntity[];
    relationships: OntologyRelationship[];
  }> {
    this.ensureInitialized();

    // BFS for shortest path
    const visited = new Set<string>();
    const queue: { id: string; path: string[]; rels: OntologyRelationship[] }[] = [
      { id: fromId, path: [fromId], rels: [] },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.id === toId) {
        // Found path - hydrate entities
        const entities = await Promise.all(
          current.path.map(id => this.getEntity(id))
        );
        return {
          found: true,
          path: entities.filter((e): e is OntologyEntity => e !== null),
          relationships: current.rels,
        };
      }

      if (current.path.length > maxHops) continue;
      if (visited.has(current.id)) continue;

      visited.add(current.id);

      const rels = await this.getRelationships(current.id, 'both');
      for (const rel of rels) {
        const neighborId = rel.sourceId === current.id ? rel.targetId : rel.sourceId;
        if (!visited.has(neighborId)) {
          queue.push({
            id: neighborId,
            path: [...current.path, neighborId],
            rels: [...current.rels, rel],
          });
        }
      }
    }

    return { found: false, path: [], relationships: [] };
  }

  // --------------------------------------------------------------------------
  // SOURCE RECORDS
  // --------------------------------------------------------------------------

  private async storeSourceRecords(entityId: string, records: SourceRecord[]): Promise<void> {
    const stmt = this.db!.prepare(`
      INSERT INTO source_records (id, entity_id, source_type, source_id, raw_data, extracted_at, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const record of records) {
      stmt.run(
        record.id,
        entityId,
        record.sourceType,
        record.sourceId,
        JSON.stringify(record.rawData),
        record.extractedAt.getTime(),
        record.confidence
      );
    }
  }

  async getSourceRecords(entityId: string): Promise<SourceRecord[]> {
    this.ensureInitialized();

    const stmt = this.db!.prepare('SELECT * FROM source_records WHERE entity_id = ?');
    const rows = stmt.all(entityId) as SourceRecordRow[];

    return rows.map(row => ({
      id: row.id,
      sourceType: row.source_type as SourceRecord['sourceType'],
      sourceId: row.source_id,
      rawData: JSON.parse(row.raw_data || '{}'),
      extractedAt: new Date(row.extracted_at),
      confidence: row.confidence,
    }));
  }

  // --------------------------------------------------------------------------
  // STATISTICS
  // --------------------------------------------------------------------------

  async getStatistics(): Promise<OntologyStatistics> {
    this.ensureInitialized();

    // Entity counts by type
    const entityCountsStmt = this.db!.prepare(`
      SELECT type, COUNT(*) as count FROM entities GROUP BY type
    `);
    const entityCountRows = entityCountsStmt.all() as { type: string; count: number }[];
    const entityCounts: Record<string, number> = {};
    let totalEntities = 0;
    for (const row of entityCountRows) {
      entityCounts[row.type] = row.count;
      totalEntities += row.count;
    }

    // Relationship counts by type
    const relCountsStmt = this.db!.prepare(`
      SELECT relationship_type, COUNT(*) as count FROM relationships GROUP BY relationship_type
    `);
    const relCountRows = relCountsStmt.all() as { relationship_type: string; count: number }[];
    const relationshipCounts: Record<string, number> = {};
    let totalRelationships = 0;
    for (const row of relCountRows) {
      relationshipCounts[row.relationship_type] = row.count;
      totalRelationships += row.count;
    }

    // Database size
    const stats = fs.statSync(this.config.dbPath!);

    return {
      entityCounts: entityCounts as Record<EntityType, number>,
      relationshipCounts: relationshipCounts as Record<RelationshipType, number>,
      totalEntities,
      totalRelationships,
      lastUpdated: new Date(),
      dbSizeBytes: stats.size,
    };
  }

  // --------------------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------------------

  private hydrateDates<T extends OntologyEntity>(entity: T): T {
    // Convert date strings back to Date objects
    const dateFields = [
      'createdAt',
      'updatedAt',
      'startDate',
      'targetEndDate',
      'actualEndDate',
      'dueDate',
      'completedAt',
      'startTime',
      'endTime',
      'modifiedAt',
      'accessedAt',
      'executedAt',
    ];

    for (const field of dateFields) {
      if (field in entity && entity[field as keyof T]) {
        const value = entity[field as keyof T];
        if (typeof value === 'string' || typeof value === 'number') {
          (entity as Record<string, unknown>)[field] = new Date(value);
        }
      }
    }

    return entity;
  }

  private rowToRelationship(row: RelationshipRow): OntologyRelationship {
    return {
      id: row.id,
      sourceId: row.source_id,
      sourceType: row.source_type as EntityType,
      targetId: row.target_id,
      targetType: row.target_type as EntityType,
      relationshipType: row.relationship_type as RelationshipType,
      properties: JSON.parse(row.properties || '{}'),
      startDate: row.start_date ? new Date(row.start_date) : null,
      endDate: row.end_date ? new Date(row.end_date) : null,
      strength: row.strength,
      confidence: row.confidence,
      sourceRecords: [],
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

// ============================================================================
// ROW TYPES
// ============================================================================

interface RelationshipRow {
  id: string;
  source_id: string;
  source_type: string;
  target_id: string;
  target_type: string;
  relationship_type: string;
  properties: string;
  start_date: number | null;
  end_date: number | null;
  strength: number;
  confidence: number;
  created_at: number;
  updated_at: number;
}

interface SourceRecordRow {
  id: string;
  entity_id: string;
  source_type: string;
  source_id: string;
  raw_data: string;
  extracted_at: number;
  confidence: number;
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: OntologyStore | null = null;

export function getOntologyStore(): OntologyStore {
  if (!instance) {
    instance = new OntologyStore();
  }
  return instance;
}

export async function initializeOntologyStore(config?: OntologyStoreConfig): Promise<OntologyStore> {
  const store = config ? new OntologyStore(config) : getOntologyStore();
  await store.initialize();
  return store;
}
