/**
 * Atlas Desktop - Knowledge Store
 * Persistent storage for structured facts and learned knowledge
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('KnowledgeStore');

/**
 * Knowledge categories for organized storage
 */
export type KnowledgeCategory =
  | 'user_preference' // Things the user likes/dislikes
  | 'user_fact' // Facts about the user (name, job, location)
  | 'user_habit' // User habits and patterns
  | 'world_fact' // General world knowledge
  | 'task_pattern' // Common task patterns
  | 'relationship' // Relationships between entities
  | 'custom'; // User-defined category

/**
 * Confidence level for knowledge entries
 */
export type ConfidenceLevel = 'low' | 'medium' | 'high' | 'verified';

/**
 * Knowledge entry representing a single piece of information
 */
export interface KnowledgeEntry {
  /** Unique identifier */
  id: string;
  /** Knowledge category */
  category: KnowledgeCategory;
  /** Subject of the knowledge (e.g., "user", "coffee", "meetings") */
  subject: string;
  /** Predicate/relationship (e.g., "likes", "works_at", "prefers") */
  predicate: string;
  /** Object of the knowledge (e.g., "dark roast", "Google", "mornings") */
  object: string;
  /** Full natural language representation */
  naturalForm: string;
  /** Confidence level */
  confidence: ConfidenceLevel;
  /** Confidence score (0-1) */
  confidenceScore: number;
  /** Source of the knowledge */
  source: 'conversation' | 'explicit' | 'inferred' | 'imported';
  /** Tags for additional categorization */
  tags: string[];
  /** Creation timestamp */
  createdAt: number;
  /** Last accessed timestamp */
  accessedAt: number;
  /** Last verified/updated timestamp */
  verifiedAt: number;
  /** Number of times this knowledge was reinforced */
  reinforcements: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Entity representing a subject or object in the knowledge graph
 */
export interface KnowledgeEntity {
  /** Entity name/id */
  name: string;
  /** Entity type (person, place, thing, concept) */
  type: 'person' | 'place' | 'thing' | 'concept' | 'action' | 'time';
  /** Related knowledge entry IDs */
  relatedKnowledge: string[];
  /** Entity aliases */
  aliases: string[];
  /** Last updated */
  updatedAt: number;
}

/**
 * Knowledge store configuration
 */
export interface KnowledgeStoreConfig {
  /** Storage directory */
  storageDir: string;
  /** Maximum entries to keep */
  maxEntries: number;
  /** Auto-save interval in ms */
  autoSaveInterval: number;
  /** Enable persistence */
  enablePersistence: boolean;
  /** Minimum confidence to keep (entries below this are pruned) */
  minConfidenceToKeep: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: KnowledgeStoreConfig = {
  storageDir: path.join(
    process.env.HOME || process.env.USERPROFILE || '.',
    '.atlas',
    'knowledge'
  ),
  maxEntries: 10000,
  autoSaveInterval: 60000, // 1 minute
  enablePersistence: true,
  minConfidenceToKeep: 0.3,
};

/**
 * Knowledge store events
 */
export interface KnowledgeStoreEvents {
  'entry-added': (entry: KnowledgeEntry) => void;
  'entry-updated': (entry: KnowledgeEntry) => void;
  'entry-removed': (id: string) => void;
  'entity-created': (entity: KnowledgeEntity) => void;
  loaded: () => void;
  saved: () => void;
  error: (error: Error) => void;
}

/**
 * Query options for searching knowledge
 */
export interface KnowledgeQuery {
  /** Filter by category */
  category?: KnowledgeCategory;
  /** Filter by subject (supports partial match) */
  subject?: string;
  /** Filter by predicate */
  predicate?: string;
  /** Filter by object (supports partial match) */
  object?: string;
  /** Filter by tags (any match) */
  tags?: string[];
  /** Minimum confidence level */
  minConfidence?: ConfidenceLevel;
  /** Minimum confidence score */
  minConfidenceScore?: number;
  /** Text search across all fields */
  text?: string;
  /** Maximum results */
  limit?: number;
  /** Sort by field */
  sortBy?: 'confidence' | 'recency' | 'reinforcements';
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

/**
 * KnowledgeStore - Manages structured knowledge storage
 */
export class KnowledgeStore extends EventEmitter {
  private config: KnowledgeStoreConfig;
  private entries: Map<string, KnowledgeEntry> = new Map();
  private entities: Map<string, KnowledgeEntity> = new Map();
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private isDirty = false;

  constructor(config?: Partial<KnowledgeStoreConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    logger.info('KnowledgeStore initialized', {
      storageDir: this.config.storageDir,
      enablePersistence: this.config.enablePersistence,
    });
  }

  /**
   * Initialize the knowledge store
   */
  async initialize(): Promise<void> {
    if (this.config.enablePersistence) {
      await this.ensureStorageDir();
      await this.load();
      this.startAutoSave();
    }
  }

  /**
   * Ensure storage directory exists
   */
  private async ensureStorageDir(): Promise<void> {
    try {
      await fs.promises.mkdir(this.config.storageDir, { recursive: true });
    } catch (error) {
      logger.error('Failed to create knowledge storage directory', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }
    this.autoSaveTimer = setInterval(() => {
      if (this.isDirty) {
        this.save().catch((e) =>
          logger.error('Auto-save failed', { error: (e as Error).message })
        );
      }
    }, this.config.autoSaveInterval);
  }

  /**
   * Stop auto-save timer
   */
  private stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `k-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Calculate confidence level from score
   */
  private getConfidenceLevel(score: number): ConfidenceLevel {
    if (score >= 0.9) return 'verified';
    if (score >= 0.7) return 'high';
    if (score >= 0.4) return 'medium';
    return 'low';
  }

  /**
   * Create a knowledge entry from structured data
   */
  addKnowledge(params: {
    category: KnowledgeCategory;
    subject: string;
    predicate: string;
    object: string;
    source?: KnowledgeEntry['source'];
    confidenceScore?: number;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): KnowledgeEntry {
    const {
      category,
      subject,
      predicate,
      object,
      source = 'conversation',
      confidenceScore = 0.5,
      tags = [],
      metadata,
    } = params;

    // Check for existing similar knowledge
    const existing = this.findSimilar(subject, predicate, object);
    if (existing) {
      // Reinforce existing knowledge
      return this.reinforceKnowledge(existing.id, confidenceScore);
    }

    const naturalForm = this.buildNaturalForm(subject, predicate, object);
    const confidence = this.getConfidenceLevel(confidenceScore);

    const entry: KnowledgeEntry = {
      id: this.generateId(),
      category,
      subject: subject.toLowerCase().trim(),
      predicate: predicate.toLowerCase().trim(),
      object: object.toLowerCase().trim(),
      naturalForm,
      confidence,
      confidenceScore,
      source,
      tags,
      createdAt: Date.now(),
      accessedAt: Date.now(),
      verifiedAt: Date.now(),
      reinforcements: 1,
      metadata,
    };

    this.entries.set(entry.id, entry);
    this.updateEntities(entry);
    this.isDirty = true;

    this.emit('entry-added', entry);
    logger.debug('Knowledge added', {
      id: entry.id,
      category,
      subject,
      predicate,
      object,
    });

    return entry;
  }

  /**
   * Find similar existing knowledge
   */
  private findSimilar(
    subject: string,
    predicate: string,
    object: string
  ): KnowledgeEntry | undefined {
    const subjectLower = subject.toLowerCase().trim();
    const predicateLower = predicate.toLowerCase().trim();
    const objectLower = object.toLowerCase().trim();

    for (const entry of this.entries.values()) {
      if (
        entry.subject === subjectLower &&
        entry.predicate === predicateLower &&
        entry.object === objectLower
      ) {
        return entry;
      }
    }
    return undefined;
  }

  /**
   * Build natural language form
   */
  private buildNaturalForm(subject: string, predicate: string, object: string): string {
    // Handle different predicates to create natural sentences
    const predicateMappings: Record<string, (s: string, o: string) => string> = {
      likes: (s, o) => `${s} likes ${o}`,
      dislikes: (s, o) => `${s} dislikes ${o}`,
      prefers: (s, o) => `${s} prefers ${o}`,
      works_at: (s, o) => `${s} works at ${o}`,
      lives_in: (s, o) => `${s} lives in ${o}`,
      is_a: (s, o) => `${s} is a ${o}`,
      has: (s, o) => `${s} has ${o}`,
      uses: (s, o) => `${s} uses ${o}`,
      knows: (s, o) => `${s} knows ${o}`,
    };

    const formatter = predicateMappings[predicate.toLowerCase()];
    if (formatter) {
      return formatter(subject, object);
    }

    // Default format
    return `${subject} ${predicate} ${object}`;
  }

  /**
   * Reinforce existing knowledge
   */
  reinforceKnowledge(id: string, additionalConfidence: number = 0.1): KnowledgeEntry {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new Error(`Knowledge entry not found: ${id}`);
    }

    // Increase confidence (with diminishing returns)
    const newScore = Math.min(1, entry.confidenceScore + additionalConfidence * 0.5);
    entry.confidenceScore = newScore;
    entry.confidence = this.getConfidenceLevel(newScore);
    entry.reinforcements += 1;
    entry.verifiedAt = Date.now();
    entry.accessedAt = Date.now();

    this.isDirty = true;
    this.emit('entry-updated', entry);
    logger.debug('Knowledge reinforced', {
      id,
      reinforcements: entry.reinforcements,
      newConfidence: entry.confidenceScore,
    });

    return entry;
  }

  /**
   * Update entity index
   */
  private updateEntities(entry: KnowledgeEntry): void {
    // Update subject entity
    this.updateEntity(entry.subject, 'concept', entry.id);

    // Update object entity
    this.updateEntity(entry.object, 'concept', entry.id);
  }

  /**
   * Update or create an entity
   */
  private updateEntity(
    name: string,
    type: KnowledgeEntity['type'],
    knowledgeId: string
  ): void {
    const normalizedName = name.toLowerCase().trim();
    let entity = this.entities.get(normalizedName);

    if (!entity) {
      entity = {
        name: normalizedName,
        type,
        relatedKnowledge: [],
        aliases: [],
        updatedAt: Date.now(),
      };
      this.entities.set(normalizedName, entity);
      this.emit('entity-created', entity);
    }

    if (!entity.relatedKnowledge.includes(knowledgeId)) {
      entity.relatedKnowledge.push(knowledgeId);
    }
    entity.updatedAt = Date.now();
  }

  /**
   * Query knowledge with filters
   */
  query(options: KnowledgeQuery): KnowledgeEntry[] {
    let results = Array.from(this.entries.values());

    // Apply filters
    if (options.category) {
      results = results.filter((e) => e.category === options.category);
    }

    if (options.subject) {
      const subjectLower = options.subject.toLowerCase();
      results = results.filter((e) => e.subject.includes(subjectLower));
    }

    if (options.predicate) {
      const predicateLower = options.predicate.toLowerCase();
      results = results.filter((e) => e.predicate === predicateLower);
    }

    if (options.object) {
      const objectLower = options.object.toLowerCase();
      results = results.filter((e) => e.object.includes(objectLower));
    }

    if (options.tags && options.tags.length > 0) {
      results = results.filter((e) =>
        options.tags!.some((tag) => e.tags.includes(tag.toLowerCase()))
      );
    }

    if (options.minConfidence) {
      const minScores: Record<ConfidenceLevel, number> = {
        low: 0,
        medium: 0.4,
        high: 0.7,
        verified: 0.9,
      };
      const minScore = minScores[options.minConfidence];
      results = results.filter((e) => e.confidenceScore >= minScore);
    }

    if (options.minConfidenceScore !== undefined) {
      results = results.filter((e) => e.confidenceScore >= options.minConfidenceScore!);
    }

    if (options.text) {
      const searchText = options.text.toLowerCase();
      results = results.filter(
        (e) =>
          e.naturalForm.toLowerCase().includes(searchText) ||
          e.subject.includes(searchText) ||
          e.object.includes(searchText)
      );
    }

    // Sort results
    const sortBy = options.sortBy || 'confidence';
    const sortOrder = options.sortOrder || 'desc';
    const multiplier = sortOrder === 'desc' ? -1 : 1;

    results.sort((a, b) => {
      switch (sortBy) {
        case 'confidence':
          return (a.confidenceScore - b.confidenceScore) * multiplier;
        case 'recency':
          return (a.accessedAt - b.accessedAt) * multiplier;
        case 'reinforcements':
          return (a.reinforcements - b.reinforcements) * multiplier;
        default:
          return 0;
      }
    });

    // Mark as accessed
    for (const entry of results) {
      entry.accessedAt = Date.now();
    }
    this.isDirty = true;

    // Apply limit
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Get all knowledge about a subject
   */
  getKnowledgeAbout(subject: string): KnowledgeEntry[] {
    return this.query({ subject });
  }

  /**
   * Get user preferences
   */
  getUserPreferences(): KnowledgeEntry[] {
    return this.query({ category: 'user_preference', sortBy: 'confidence' });
  }

  /**
   * Get user facts
   */
  getUserFacts(): KnowledgeEntry[] {
    return this.query({ category: 'user_fact', sortBy: 'confidence' });
  }

  /**
   * Get entity by name
   */
  getEntity(name: string): KnowledgeEntity | undefined {
    return this.entities.get(name.toLowerCase().trim());
  }

  /**
   * Get all entities
   */
  getAllEntities(): KnowledgeEntity[] {
    return Array.from(this.entities.values());
  }

  /**
   * Remove a knowledge entry
   */
  removeKnowledge(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;

    this.entries.delete(id);

    // Update entities
    const subjectEntity = this.entities.get(entry.subject);
    if (subjectEntity) {
      subjectEntity.relatedKnowledge = subjectEntity.relatedKnowledge.filter(
        (k) => k !== id
      );
    }
    const objectEntity = this.entities.get(entry.object);
    if (objectEntity) {
      objectEntity.relatedKnowledge = objectEntity.relatedKnowledge.filter((k) => k !== id);
    }

    this.isDirty = true;
    this.emit('entry-removed', id);
    logger.debug('Knowledge removed', { id });

    return true;
  }

  /**
   * Prune low-confidence entries
   */
  pruneEntries(): number {
    let pruned = 0;
    const entriesToRemove: string[] = [];

    for (const [id, entry] of this.entries) {
      if (entry.confidenceScore < this.config.minConfidenceToKeep) {
        entriesToRemove.push(id);
      }
    }

    for (const id of entriesToRemove) {
      this.removeKnowledge(id);
      pruned++;
    }

    if (pruned > 0) {
      logger.info('Pruned low-confidence entries', { count: pruned });
    }

    return pruned;
  }

  /**
   * Get knowledge for LLM context
   */
  getContextKnowledge(query: string, limit: number = 10): string {
    // Get relevant knowledge based on query
    const relevant = this.query({
      text: query,
      minConfidence: 'medium',
      sortBy: 'confidence',
      limit,
    });

    // Also include high-confidence user preferences and facts
    const userKnowledge = [
      ...this.getUserPreferences().filter((e) => e.confidenceScore >= 0.6).slice(0, 5),
      ...this.getUserFacts().filter((e) => e.confidenceScore >= 0.6).slice(0, 5),
    ];

    // Combine and dedupe
    const combined = new Map<string, KnowledgeEntry>();
    for (const entry of [...relevant, ...userKnowledge]) {
      combined.set(entry.id, entry);
    }

    // Build context string
    const entries = Array.from(combined.values()).slice(0, limit);
    if (entries.length === 0) return '';

    const lines = entries.map((e) => `- ${e.naturalForm}`);
    return `Known facts:\n${lines.join('\n')}`;
  }

  /**
   * Save to disk
   */
  async save(): Promise<void> {
    if (!this.config.enablePersistence) return;

    try {
      const data = {
        entries: Array.from(this.entries.entries()),
        entities: Array.from(this.entities.entries()),
        savedAt: Date.now(),
      };

      const filePath = path.join(this.config.storageDir, 'knowledge.json');
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));

      this.isDirty = false;
      this.emit('saved');
      logger.info('Knowledge saved to disk', {
        entries: this.entries.size,
        entities: this.entities.size,
      });
    } catch (error) {
      logger.error('Failed to save knowledge', { error: (error as Error).message });
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Load from disk
   */
  async load(): Promise<void> {
    if (!this.config.enablePersistence) return;

    const filePath = path.join(this.config.storageDir, 'knowledge.json');

    try {
      const exists = await fs.promises
        .access(filePath)
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        logger.info('No existing knowledge file found');
        return;
      }

      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as {
        entries: Array<[string, KnowledgeEntry]>;
        entities: Array<[string, KnowledgeEntity]>;
      };

      this.entries = new Map(data.entries);
      this.entities = new Map(data.entities);

      this.emit('loaded');
      logger.info('Knowledge loaded from disk', {
        entries: this.entries.size,
        entities: this.entities.size,
      });
    } catch (error) {
      logger.error('Failed to load knowledge', { error: (error as Error).message });
      this.emit('error', error as Error);
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalEntries: number;
    totalEntities: number;
    byCategory: Record<KnowledgeCategory, number>;
    byConfidence: Record<ConfidenceLevel, number>;
    averageConfidence: number;
  } {
    const byCategory: Record<KnowledgeCategory, number> = {
      user_preference: 0,
      user_fact: 0,
      user_habit: 0,
      world_fact: 0,
      task_pattern: 0,
      relationship: 0,
      custom: 0,
    };

    const byConfidence: Record<ConfidenceLevel, number> = {
      low: 0,
      medium: 0,
      high: 0,
      verified: 0,
    };

    let totalConfidence = 0;

    for (const entry of this.entries.values()) {
      byCategory[entry.category]++;
      byConfidence[entry.confidence]++;
      totalConfidence += entry.confidenceScore;
    }

    return {
      totalEntries: this.entries.size,
      totalEntities: this.entities.size,
      byCategory,
      byConfidence,
      averageConfidence: this.entries.size > 0 ? totalConfidence / this.entries.size : 0,
    };
  }

  /**
   * Clear all knowledge
   */
  async clear(): Promise<void> {
    this.entries.clear();
    this.entities.clear();
    this.isDirty = true;
    await this.save();
    logger.info('Knowledge cleared');
  }

  /**
   * Shutdown the knowledge store
   */
  async shutdown(): Promise<void> {
    this.stopAutoSave();
    if (this.isDirty) {
      await this.save();
    }
    this.removeAllListeners();
    logger.info('KnowledgeStore shutdown');
  }

  // Type-safe event emitter methods
  on<K extends keyof KnowledgeStoreEvents>(
    event: K,
    listener: KnowledgeStoreEvents[K]
  ): this {
    return super.on(event, listener);
  }

  off<K extends keyof KnowledgeStoreEvents>(
    event: K,
    listener: KnowledgeStoreEvents[K]
  ): this {
    return super.off(event, listener);
  }

  emit<K extends keyof KnowledgeStoreEvents>(
    event: K,
    ...args: Parameters<KnowledgeStoreEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let knowledgeStore: KnowledgeStore | null = null;

/**
 * Get or create the knowledge store instance
 */
export async function getKnowledgeStore(
  config?: Partial<KnowledgeStoreConfig>
): Promise<KnowledgeStore> {
  if (!knowledgeStore) {
    knowledgeStore = new KnowledgeStore(config);
    await knowledgeStore.initialize();
  }
  return knowledgeStore;
}

/**
 * Shutdown the knowledge store
 */
export async function shutdownKnowledgeStore(): Promise<void> {
  if (knowledgeStore) {
    await knowledgeStore.shutdown();
    knowledgeStore = null;
  }
}

export default KnowledgeStore;
