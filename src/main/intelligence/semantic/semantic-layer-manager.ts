/**
 * Semantic Layer Manager
 * Orchestrates data source parsers and ontology ingestion
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { getOntologyStore, OntologyStore } from '../ontology/ontology-store';
import { getEntityManager, EntityManager } from '../ontology/entity-manager';
import { getRelationshipManager, RelationshipManager } from '../ontology/relationship-manager';
import {
  DataSourceType,
  OntologyEntity,
  OntologyRelationship,
  IngestResult,
  SyncReport,
} from '../types';
import {
  SemanticParser,
  DataSource,
  SemanticLayerConfig,
  SyncSchedule,
} from './types';

const logger = createModuleLogger('SemanticLayerManager');

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: SemanticLayerConfig = {
  parsers: [],
  syncSchedule: {
    interval: 60, // minutes
    enabled: true,
    lastRun: null,
    nextRun: null,
  },
  embeddingModel: 'text-embedding-3-small',
  maxConcurrentParsers: 3,
};

// ============================================================================
// SEMANTIC LAYER MANAGER
// ============================================================================

export class SemanticLayerManager extends EventEmitter {
  private config: SemanticLayerConfig;
  private parsers: Map<DataSourceType, SemanticParser<unknown, unknown>> = new Map();
  private dataSources: Map<string, DataSource> = new Map();
  private store: OntologyStore;
  private entityManager: EntityManager;
  private relationshipManager: RelationshipManager;
  private syncTimer: NodeJS.Timeout | null = null;
  private isSyncing = false;

  constructor(config?: Partial<SemanticLayerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.store = getOntologyStore();
    this.entityManager = getEntityManager();
    this.relationshipManager = getRelationshipManager();
  }

  // --------------------------------------------------------------------------
  // INITIALIZATION
  // --------------------------------------------------------------------------

  async initialize(): Promise<void> {
    logger.info('Initializing SemanticLayerManager');

    // Ensure ontology store is ready
    await this.store.initialize();

    // Start sync scheduler if enabled
    if (this.config.syncSchedule.enabled) {
      this.startSyncScheduler();
    }

    logger.info('SemanticLayerManager initialized', {
      parserCount: this.parsers.size,
      syncEnabled: this.config.syncSchedule.enabled,
    });
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down SemanticLayerManager');

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  // --------------------------------------------------------------------------
  // PARSER REGISTRATION
  // --------------------------------------------------------------------------

  registerParser<TInput, TOutput>(
    sourceType: DataSourceType,
    parser: SemanticParser<TInput, TOutput>
  ): void {
    this.parsers.set(sourceType, parser as SemanticParser<unknown, unknown>);
    logger.info('Parser registered', { sourceType, parserName: parser.name });
  }

  getParser<TInput, TOutput>(sourceType: DataSourceType): SemanticParser<TInput, TOutput> | null {
    return (this.parsers.get(sourceType) as SemanticParser<TInput, TOutput>) || null;
  }

  // --------------------------------------------------------------------------
  // DATA SOURCE MANAGEMENT
  // --------------------------------------------------------------------------

  registerDataSource(source: DataSource): void {
    this.dataSources.set(source.id, source);
    logger.info('Data source registered', { id: source.id, type: source.type });
    this.emit('source:registered', source);
  }

  getDataSource(id: string): DataSource | null {
    return this.dataSources.get(id) || null;
  }

  getDataSources(): DataSource[] {
    return Array.from(this.dataSources.values());
  }

  getDataSourcesByType(type: DataSourceType): DataSource[] {
    return Array.from(this.dataSources.values()).filter(s => s.type === type);
  }

  updateDataSourceStatus(
    id: string,
    status: DataSource['syncStatus'],
    error?: string
  ): void {
    const source = this.dataSources.get(id);
    if (source) {
      source.syncStatus = status;
      source.errorMessage = error;
      if (status === 'idle') {
        source.lastSync = new Date();
      }
      this.emit('source:updated', source);
    }
  }

  // --------------------------------------------------------------------------
  // INGESTION
  // --------------------------------------------------------------------------

  async ingestFromSource<TInput>(
    sourceId: string,
    rawData: TInput
  ): Promise<IngestResult> {
    const startTime = Date.now();
    const source = this.dataSources.get(sourceId);

    if (!source) {
      throw new Error(`Data source not found: ${sourceId}`);
    }

    const parser = this.parsers.get(source.type);
    if (!parser) {
      throw new Error(`No parser registered for source type: ${source.type}`);
    }

    const result: IngestResult = {
      source: source.type,
      entitiesCreated: 0,
      entitiesUpdated: 0,
      relationshipsCreated: 0,
      errors: [],
      duration: 0,
    };

    try {
      this.updateDataSourceStatus(sourceId, 'syncing');
      this.emit('ingest:started', { sourceId, sourceType: source.type });

      // Parse the raw data
      const parsed = await parser.parse(rawData);

      // Extract entities and relationships
      const entities = parser.extractEntities(parsed);
      const relationships = parser.extractRelationships(parsed);

      // Generate embeddings
      const embeddings = await parser.generateEmbeddings(parsed);

      // Store entities
      for (const entity of entities) {
        try {
          // Check if entity already exists (by source ID or similar key)
          const existing = await this.findExistingEntity(entity);
          if (existing) {
            await this.entityManager.update(existing.id, entity);
            result.entitiesUpdated++;
          } else {
            await this.entityManager.create(entity);
            result.entitiesCreated++;
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push(`Entity ${entity.id}: ${msg}`);
          logger.warn('Failed to store entity', { entityId: entity.id, error: msg });
        }
      }

      // Store relationships
      for (const rel of relationships) {
        try {
          await this.relationshipManager.create({
            sourceId: rel.sourceId,
            sourceType: rel.sourceType,
            targetId: rel.targetId,
            targetType: rel.targetType,
            relationshipType: rel.relationshipType,
            properties: rel.properties,
            strength: rel.strength,
            confidence: rel.confidence,
          });
          result.relationshipsCreated++;
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push(`Relationship ${rel.id}: ${msg}`);
          logger.warn('Failed to store relationship', { relId: rel.id, error: msg });
        }
      }

      this.updateDataSourceStatus(sourceId, 'idle');
      result.duration = Date.now() - startTime;

      logger.info('Ingestion completed', {
        sourceId,
        sourceType: source.type,
        entities: result.entitiesCreated + result.entitiesUpdated,
        relationships: result.relationshipsCreated,
        duration: result.duration,
      });

      this.emit('ingest:completed', { sourceId, result });
      return result;

    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.updateDataSourceStatus(sourceId, 'error', msg);
      result.errors.push(msg);
      result.duration = Date.now() - startTime;

      logger.error('Ingestion failed', { sourceId, error: msg });
      this.emit('ingest:failed', { sourceId, error: msg });

      return result;
    }
  }

  private async findExistingEntity(entity: OntologyEntity): Promise<OntologyEntity | null> {
    // Try to find by ID first
    const byId = await this.entityManager.get(entity.id);
    if (byId) return byId;

    // For Person entities, try to find by email
    if (entity.type === 'Person' && 'emails' in entity) {
      const personEntity = entity as OntologyEntity & { emails: { email: string }[] };
      for (const emailObj of personEntity.emails) {
        const byEmail = await this.entityManager.getPersonByEmail(emailObj.email);
        if (byEmail) return byEmail;
      }
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // SYNC OPERATIONS
  // --------------------------------------------------------------------------

  async syncAll(): Promise<SyncReport> {
    if (this.isSyncing) {
      throw new Error('Sync already in progress');
    }

    this.isSyncing = true;
    const startedAt = new Date();
    const results: IngestResult[] = [];

    logger.info('Starting full sync');
    this.emit('sync:started');

    try {
      const sources = this.getDataSources().filter(s => s.enabled);

      for (const source of sources) {
        try {
          // Each source type needs its own data fetching logic
          // This would be implemented by the specific connectors
          const result = await this.syncSource(source);
          results.push(result);
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          logger.error('Failed to sync source', { sourceId: source.id, error: msg });
          results.push({
            source: source.type,
            entitiesCreated: 0,
            entitiesUpdated: 0,
            relationshipsCreated: 0,
            errors: [msg],
            duration: 0,
          });
        }
      }

      const report: SyncReport = {
        startedAt,
        completedAt: new Date(),
        sources: results,
        totalEntities: results.reduce((sum, r) => sum + r.entitiesCreated + r.entitiesUpdated, 0),
        totalRelationships: results.reduce((sum, r) => sum + r.relationshipsCreated, 0),
        success: results.every(r => r.errors.length === 0),
      };

      this.config.syncSchedule.lastRun = report.completedAt;
      logger.info('Full sync completed', {
        entities: report.totalEntities,
        relationships: report.totalRelationships,
        success: report.success,
      });

      this.emit('sync:completed', report);
      return report;

    } finally {
      this.isSyncing = false;
    }
  }

  private async syncSource(source: DataSource): Promise<IngestResult> {
    // Placeholder - actual implementation would use connectors
    // to fetch data from the source and call ingestFromSource
    logger.debug('Syncing source', { sourceId: source.id, type: source.type });

    return {
      source: source.type,
      entitiesCreated: 0,
      entitiesUpdated: 0,
      relationshipsCreated: 0,
      errors: [],
      duration: 0,
    };
  }

  // --------------------------------------------------------------------------
  // SYNC SCHEDULER
  // --------------------------------------------------------------------------

  private startSyncScheduler(): void {
    const intervalMs = this.config.syncSchedule.interval * 60 * 1000;

    this.syncTimer = setInterval(async () => {
      if (!this.isSyncing) {
        try {
          await this.syncAll();
        } catch (error) {
          logger.error('Scheduled sync failed', { error });
        }
      }
    }, intervalMs);

    this.config.syncSchedule.nextRun = new Date(Date.now() + intervalMs);
    logger.info('Sync scheduler started', { intervalMinutes: this.config.syncSchedule.interval });
  }

  setSyncSchedule(schedule: Partial<SyncSchedule>): void {
    Object.assign(this.config.syncSchedule, schedule);

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    if (this.config.syncSchedule.enabled) {
      this.startSyncScheduler();
    }
  }

  // --------------------------------------------------------------------------
  // STATUS
  // --------------------------------------------------------------------------

  getStatus(): {
    initialized: boolean;
    syncing: boolean;
    parserCount: number;
    sourceCount: number;
    schedule: SyncSchedule;
  } {
    return {
      initialized: true,
      syncing: this.isSyncing,
      parserCount: this.parsers.size,
      sourceCount: this.dataSources.size,
      schedule: this.config.syncSchedule,
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: SemanticLayerManager | null = null;

export function getSemanticLayerManager(): SemanticLayerManager {
  if (!instance) {
    instance = new SemanticLayerManager();
  }
  return instance;
}

export async function initializeSemanticLayer(
  config?: Partial<SemanticLayerConfig>
): Promise<SemanticLayerManager> {
  const manager = config ? new SemanticLayerManager(config) : getSemanticLayerManager();
  await manager.initialize();
  return manager;
}
