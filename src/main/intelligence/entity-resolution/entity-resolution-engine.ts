/**
 * Entity Resolution Engine
 * Deduplicates, merges, and resolves entities across data sources
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { getOntologyStore } from '../ontology/ontology-store';
import { getEntityManager } from '../ontology/entity-manager';
import {
  OntologyEntity,
  EntityType,
  PersonEntity,
  OrganizationEntity,
} from '../types';
import {
  EntityMatch,
  MatchReason,
  MergeResult,
  ResolutionSession,
  EntityResolutionConfig,
  BlockingConfig,
  DEFAULT_RESOLUTION_CONFIG,
} from './types';

const logger = createModuleLogger('EntityResolutionEngine');

// ============================================================================
// ENTITY RESOLUTION ENGINE
// ============================================================================

export class EntityResolutionEngine extends EventEmitter {
  private config: EntityResolutionConfig;
  private currentSession: ResolutionSession | null = null;
  private mergeHistory: Map<string, string> = new Map(); // mergedId -> survivorId

  constructor(config?: Partial<EntityResolutionConfig>) {
    super();
    this.config = { ...DEFAULT_RESOLUTION_CONFIG, ...config };
  }

  // --------------------------------------------------------------------------
  // MAIN RESOLUTION WORKFLOW
  // --------------------------------------------------------------------------

  /**
   * Run entity resolution on all entities of a given type
   */
  async resolveAll(entityType?: EntityType): Promise<ResolutionSession> {
    const sessionId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.currentSession = {
      id: sessionId,
      startedAt: new Date(),
      entityType,
      totalEntities: 0,
      blocksGenerated: 0,
      comparisonsPerformed: 0,
      matchesFound: 0,
      mergesExecuted: 0,
      status: 'running',
    };

    logger.info('Starting entity resolution', { sessionId, entityType });
    this.emit('session:started', this.currentSession);

    try {
      // Get entities to resolve
      const store = getOntologyStore();
      const entities = entityType
        ? (await Promise.all(
            store.search(entityType, 10000).map(e => store.getEntity(e.id))
          )).filter((e): e is OntologyEntity => e !== null)
        : (await Promise.all(
            store.getAllEntities(10000).map(e => store.getEntity(e.id))
          )).filter((e): e is OntologyEntity => e !== null);

      this.currentSession.totalEntities = entities.length;

      // Group entities by type
      const byType = this.groupByType(entities);

      // Process each type
      for (const [type, typeEntities] of byType) {
        await this.resolveEntitiesOfType(type as EntityType, typeEntities);
      }

      this.currentSession.status = 'completed';
      this.currentSession.completedAt = new Date();

      logger.info('Entity resolution completed', {
        sessionId,
        matches: this.currentSession.matchesFound,
        merges: this.currentSession.mergesExecuted,
      });

      this.emit('session:completed', this.currentSession);
      return this.currentSession;

    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.currentSession.status = 'failed';
      this.currentSession.error = msg;
      this.currentSession.completedAt = new Date();

      logger.error('Entity resolution failed', { sessionId, error: msg });
      this.emit('session:failed', this.currentSession);

      return this.currentSession;
    }
  }

  /**
   * Resolve entities of a specific type
   */
  private async resolveEntitiesOfType(
    type: EntityType,
    entities: OntologyEntity[]
  ): Promise<void> {
    logger.debug('Resolving entities of type', { type, count: entities.length });

    // Generate blocks
    const blocks = this.generateBlocks(entities);
    if (this.currentSession) {
      this.currentSession.blocksGenerated += blocks.size;
    }

    // Find matches within blocks
    const matches: EntityMatch[] = [];

    for (const [blockKey, blockEntities] of blocks) {
      if (blockEntities.length > this.config.blocking.maxBlockSize) {
        logger.warn('Block too large, skipping', { blockKey, size: blockEntities.length });
        continue;
      }

      const blockMatches = await this.findMatchesInBlock(type, blockEntities);
      matches.push(...blockMatches);
    }

    if (this.currentSession) {
      this.currentSession.matchesFound += matches.length;
    }

    // Apply transitive matching if enabled
    if (this.config.matching.enableTransitiveMatching) {
      this.applyTransitiveMatching(matches);
    }

    // Process matches
    await this.processMatches(matches);
  }

  // --------------------------------------------------------------------------
  // BLOCKING
  // --------------------------------------------------------------------------

  /**
   * Generate blocking keys to reduce comparison space
   */
  private generateBlocks(entities: OntologyEntity[]): Map<string, OntologyEntity[]> {
    const blocks = new Map<string, OntologyEntity[]>();

    for (const entity of entities) {
      const blockKeys = this.getBlockingKeys(entity);

      for (const key of blockKeys) {
        if (!blocks.has(key)) {
          blocks.set(key, []);
        }
        blocks.get(key)!.push(entity);
      }
    }

    // Filter blocks with only one entity
    for (const [key, blockEntities] of blocks) {
      if (blockEntities.length < 2) {
        blocks.delete(key);
      }
    }

    return blocks;
  }

  /**
   * Generate blocking keys for an entity
   */
  private getBlockingKeys(entity: OntologyEntity): string[] {
    const keys: string[] = [];

    for (const blockingKey of this.config.blocking.keys) {
      const values = this.extractFieldValues(entity, blockingKey.fields);

      for (const value of values) {
        const transformed = this.transformBlockingKey(value, blockingKey);
        if (transformed) {
          keys.push(`${blockingKey.name}:${transformed}`);
        }
      }
    }

    return keys;
  }

  /**
   * Extract field values from entity (supports nested fields)
   */
  private extractFieldValues(entity: OntologyEntity, fields: string[]): string[] {
    const values: string[] = [];

    for (const field of fields) {
      const parts = field.split('.');
      let current: unknown = entity;

      for (const part of parts) {
        if (current === null || current === undefined) break;

        if (Array.isArray(current)) {
          // Handle array of objects
          const arrayValues: string[] = [];
          for (const item of current) {
            if (item && typeof item === 'object' && part in item) {
              arrayValues.push(String((item as Record<string, unknown>)[part]));
            }
          }
          values.push(...arrayValues);
          current = null;
        } else if (typeof current === 'object') {
          current = (current as Record<string, unknown>)[part];
        } else {
          current = null;
        }
      }

      if (current !== null && current !== undefined && !Array.isArray(current)) {
        values.push(String(current));
      }
    }

    return values.filter(v => v && v.length > 0);
  }

  /**
   * Transform a blocking key value
   */
  private transformBlockingKey(
    value: string,
    config: BlockingConfig['keys'][0]
  ): string | null {
    if (!value) return null;

    switch (config.transform) {
      case 'lowercase':
        return value.toLowerCase();

      case 'prefix':
        const prefixLen = config.prefixLength || 3;
        return value.toLowerCase().slice(0, prefixLen);

      case 'soundex':
        return this.soundex(value);

      case 'metaphone':
        return this.metaphone(value);

      case 'ngram':
        const ngramSize = config.ngramSize || 2;
        return this.ngrams(value.toLowerCase(), ngramSize).join('|');

      default:
        return value.toLowerCase();
    }
  }

  // --------------------------------------------------------------------------
  // MATCHING
  // --------------------------------------------------------------------------

  /**
   * Find matches within a block
   */
  private async findMatchesInBlock(
    type: EntityType,
    entities: OntologyEntity[]
  ): Promise<EntityMatch[]> {
    const matches: EntityMatch[] = [];

    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        if (this.currentSession) {
          this.currentSession.comparisonsPerformed++;
        }

        const match = await this.compareEntities(type, entities[i], entities[j]);

        if (match && match.confidence >= this.config.matching.minConfidence) {
          matches.push(match);
        }
      }
    }

    return matches;
  }

  /**
   * Compare two entities and calculate match score
   */
  private async compareEntities(
    type: EntityType,
    e1: OntologyEntity,
    e2: OntologyEntity
  ): Promise<EntityMatch | null> {
    const reasons: MatchReason[] = [];
    let totalScore = 0;
    let totalWeight = 0;

    // Type-specific comparison
    switch (type) {
      case 'Person':
        await this.comparePersonEntities(e1 as PersonEntity, e2 as PersonEntity, reasons);
        break;

      case 'Organization':
        this.compareOrganizationEntities(
          e1 as OrganizationEntity,
          e2 as OrganizationEntity,
          reasons
        );
        break;

      default:
        // Generic comparison
        this.compareGenericEntities(e1, e2, reasons);
    }

    // Calculate weighted score
    for (const reason of reasons) {
      const weight = this.config.matching.fieldWeights[reason.field] || 0.1;
      totalScore += reason.score * weight;
      totalWeight += weight;
    }

    if (totalWeight === 0) return null;

    const confidence = totalScore / totalWeight;

    if (confidence < this.config.matching.minConfidence) {
      return null;
    }

    // Determine suggested action
    let suggestedAction: EntityMatch['suggestedAction'];
    if (confidence >= this.config.autoMergeThreshold) {
      suggestedAction = 'merge';
    } else if (confidence >= this.config.manualReviewThreshold) {
      suggestedAction = 'link';
    } else {
      suggestedAction = 'ignore';
    }

    return {
      entity1Id: e1.id,
      entity2Id: e2.id,
      entityType: type,
      confidence,
      matchReasons: reasons,
      suggestedAction,
    };
  }

  /**
   * Compare Person entities
   */
  private async comparePersonEntities(
    p1: PersonEntity,
    p2: PersonEntity,
    reasons: MatchReason[]
  ): Promise<void> {
    // Compare emails
    const emails1 = new Set(p1.emails.map(e => e.email.toLowerCase()));
    const emails2 = new Set(p2.emails.map(e => e.email.toLowerCase()));
    const emailOverlap = [...emails1].filter(e => emails2.has(e));

    if (emailOverlap.length > 0) {
      reasons.push({
        field: 'email',
        type: 'exact',
        score: 1.0,
        details: `Matching emails: ${emailOverlap.join(', ')}`,
      });
    }

    // Compare phones
    const phones1 = new Set(p1.phones.map(p => this.normalizePhone(p.number)));
    const phones2 = new Set(p2.phones.map(p => this.normalizePhone(p.number)));
    const phoneOverlap = [...phones1].filter(p => phones2.has(p));

    if (phoneOverlap.length > 0) {
      reasons.push({
        field: 'phone',
        type: 'exact',
        score: 1.0,
        details: 'Matching phone numbers',
      });
    }

    // Compare names
    const nameSimilarity = this.compareNames(p1.name, p2.name);
    if (nameSimilarity > 0.7) {
      reasons.push({
        field: 'name',
        type: nameSimilarity === 1 ? 'exact' : 'fuzzy',
        score: nameSimilarity,
        details: `Name similarity: ${Math.round(nameSimilarity * 100)}%`,
      });
    }

    // Compare organization
    if (p1.currentCompany && p2.currentCompany) {
      const orgSimilarity = this.stringSimilarity(
        p1.currentCompany.toLowerCase(),
        p2.currentCompany.toLowerCase()
      );
      if (orgSimilarity > 0.8) {
        reasons.push({
          field: 'organization',
          type: orgSimilarity === 1 ? 'exact' : 'fuzzy',
          score: orgSimilarity,
          details: 'Same organization',
        });
      }
    }
  }

  /**
   * Compare Organization entities
   */
  private compareOrganizationEntities(
    o1: OrganizationEntity,
    o2: OrganizationEntity,
    reasons: MatchReason[]
  ): void {
    // Compare domains
    const domains1 = new Set(o1.domains?.map(d => d.toLowerCase()) || []);
    const domains2 = new Set(o2.domains?.map(d => d.toLowerCase()) || []);
    const domainOverlap = [...domains1].filter(d => domains2.has(d));

    if (domainOverlap.length > 0) {
      reasons.push({
        field: 'domain',
        type: 'exact',
        score: 1.0,
        details: `Matching domains: ${domainOverlap.join(', ')}`,
      });
    }

    // Compare names
    const nameSimilarity = this.stringSimilarity(o1.name.toLowerCase(), o2.name.toLowerCase());
    if (nameSimilarity > 0.7) {
      reasons.push({
        field: 'name',
        type: nameSimilarity === 1 ? 'exact' : 'fuzzy',
        score: nameSimilarity,
        details: `Name similarity: ${Math.round(nameSimilarity * 100)}%`,
      });
    }

    // Compare websites
    if (o1.website && o2.website) {
      const website1 = this.normalizeUrl(o1.website);
      const website2 = this.normalizeUrl(o2.website);
      if (website1 === website2) {
        reasons.push({
          field: 'website',
          type: 'exact',
          score: 1.0,
          details: 'Same website',
        });
      }
    }
  }

  /**
   * Generic entity comparison
   */
  private compareGenericEntities(
    e1: OntologyEntity,
    e2: OntologyEntity,
    reasons: MatchReason[]
  ): void {
    // Compare names
    const nameSimilarity = this.stringSimilarity(e1.name.toLowerCase(), e2.name.toLowerCase());
    if (nameSimilarity > 0.8) {
      reasons.push({
        field: 'name',
        type: nameSimilarity === 1 ? 'exact' : 'fuzzy',
        score: nameSimilarity,
        details: `Name similarity: ${Math.round(nameSimilarity * 100)}%`,
      });
    }

    // Compare sources
    const sources1 = new Set(e1.sources);
    const sources2 = new Set(e2.sources);
    const sourceOverlap = [...sources1].filter(s => sources2.has(s));

    if (sourceOverlap.length > 0) {
      reasons.push({
        field: 'source',
        type: 'exact',
        score: 0.3 + sourceOverlap.length * 0.2,
        details: `Common sources: ${sourceOverlap.join(', ')}`,
      });
    }
  }

  // --------------------------------------------------------------------------
  // TRANSITIVE MATCHING
  // --------------------------------------------------------------------------

  /**
   * Apply transitive closure to matches (if A=B and B=C, then A=C)
   */
  private applyTransitiveMatching(matches: EntityMatch[]): void {
    // Build adjacency map
    const adjacency = new Map<string, Set<string>>();

    for (const match of matches) {
      if (!adjacency.has(match.entity1Id)) {
        adjacency.set(match.entity1Id, new Set());
      }
      if (!adjacency.has(match.entity2Id)) {
        adjacency.set(match.entity2Id, new Set());
      }

      adjacency.get(match.entity1Id)!.add(match.entity2Id);
      adjacency.get(match.entity2Id)!.add(match.entity1Id);
    }

    // Find connected components
    const visited = new Set<string>();
    const components: Set<string>[] = [];

    for (const entityId of adjacency.keys()) {
      if (visited.has(entityId)) continue;

      const component = new Set<string>();
      const queue = [entityId];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;

        visited.add(current);
        component.add(current);

        const neighbors = adjacency.get(current) || new Set();
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            queue.push(neighbor);
          }
        }
      }

      if (component.size > 2) {
        components.push(component);
      }
    }

    // Add transitive matches
    for (const component of components) {
      const entities = Array.from(component);

      for (let i = 0; i < entities.length; i++) {
        for (let j = i + 1; j < entities.length; j++) {
          // Check if this pair already has a match
          const existingMatch = matches.find(
            m =>
              (m.entity1Id === entities[i] && m.entity2Id === entities[j]) ||
              (m.entity1Id === entities[j] && m.entity2Id === entities[i])
          );

          if (!existingMatch) {
            // Add transitive match with lower confidence
            matches.push({
              entity1Id: entities[i],
              entity2Id: entities[j],
              entityType: 'Person', // Assume type from component
              confidence: 0.7, // Lower confidence for transitive matches
              matchReasons: [
                {
                  field: 'transitive',
                  type: 'transitive',
                  score: 0.7,
                  details: 'Inferred through connected entities',
                },
              ],
              suggestedAction: 'link',
            });
          }
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // MERGE PROCESSING
  // --------------------------------------------------------------------------

  /**
   * Process matches and execute merges
   */
  private async processMatches(matches: EntityMatch[]): Promise<void> {
    // Sort by confidence (highest first)
    matches.sort((a, b) => b.confidence - a.confidence);

    // Track merged entities to avoid double-merging
    const merged = new Set<string>();

    for (const match of matches) {
      if (match.suggestedAction !== 'merge') continue;
      if (merged.has(match.entity1Id) || merged.has(match.entity2Id)) continue;

      const result = await this.mergeEntities(match.entity1Id, match.entity2Id);

      if (result.success) {
        merged.add(result.mergedId);
        this.mergeHistory.set(result.mergedId, result.survivorId);

        if (this.currentSession) {
          this.currentSession.mergesExecuted++;
        }

        this.emit('merge:completed', result);
      }
    }
  }

  /**
   * Merge two entities
   */
  async mergeEntities(entity1Id: string, entity2Id: string): Promise<MergeResult> {
    const entityManager = getEntityManager();

    const e1 = await entityManager.get(entity1Id);
    const e2 = await entityManager.get(entity2Id);

    if (!e1 || !e2) {
      return {
        success: false,
        survivorId: entity1Id,
        mergedId: entity2Id,
        fieldsConflicted: [],
        fieldsResolved: [],
        newEntity: null as any,
      };
    }

    // Determine survivor (higher confidence or more data)
    const [survivor, merged] = this.selectSurvivor(e1, e2);

    // Merge fields
    const { mergedEntity, conflicted, resolved } = this.mergeFields(survivor, merged);

    // Update survivor with merged data
    await entityManager.update(survivor.id, mergedEntity);

    // Delete merged entity
    await entityManager.delete(merged.id);

    logger.debug('Merged entities', {
      survivorId: survivor.id,
      mergedId: merged.id,
      fieldsResolved: resolved.length,
    });

    return {
      success: true,
      survivorId: survivor.id,
      mergedId: merged.id,
      fieldsConflicted: conflicted,
      fieldsResolved: resolved,
      newEntity: { ...survivor, ...mergedEntity },
    };
  }

  /**
   * Select which entity survives the merge
   */
  private selectSurvivor(e1: OntologyEntity, e2: OntologyEntity): [OntologyEntity, OntologyEntity] {
    // Prefer higher confidence
    if (e1.confidence !== e2.confidence) {
      return e1.confidence > e2.confidence ? [e1, e2] : [e2, e1];
    }

    // Prefer more sources
    if (e1.sources.length !== e2.sources.length) {
      return e1.sources.length > e2.sources.length ? [e1, e2] : [e2, e1];
    }

    // Prefer older (more established)
    return e1.createdAt < e2.createdAt ? [e1, e2] : [e2, e1];
  }

  /**
   * Merge fields from two entities
   */
  private mergeFields(
    survivor: OntologyEntity,
    merged: OntologyEntity
  ): { mergedEntity: Partial<OntologyEntity>; conflicted: string[]; resolved: string[] } {
    const result: Partial<OntologyEntity> = {};
    const conflicted: string[] = [];
    const resolved: string[] = [];

    // Merge sources (union)
    const allSources = new Set([...survivor.sources, ...merged.sources]);
    result.sources = Array.from(allSources) as any;
    resolved.push('sources');

    // Update timestamp
    result.updatedAt = new Date();

    // Boost confidence
    result.confidence = Math.min(1, survivor.confidence + 0.1);

    // Type-specific field merging
    if (survivor.type === 'Person') {
      this.mergePersonFields(
        survivor as PersonEntity,
        merged as PersonEntity,
        result as Partial<PersonEntity>,
        conflicted,
        resolved
      );
    }

    return { mergedEntity: result, conflicted, resolved };
  }

  /**
   * Merge Person-specific fields
   */
  private mergePersonFields(
    survivor: PersonEntity,
    merged: PersonEntity,
    result: Partial<PersonEntity>,
    conflicted: string[],
    resolved: string[]
  ): void {
    // Merge emails (union)
    const emailMap = new Map<string, PersonEntity['emails'][0]>();
    for (const email of [...survivor.emails, ...merged.emails]) {
      const key = email.email.toLowerCase();
      if (!emailMap.has(key)) {
        emailMap.set(key, email);
      }
    }
    result.emails = Array.from(emailMap.values());
    resolved.push('emails');

    // Merge phones (union)
    const phoneMap = new Map<string, PersonEntity['phones'][0]>();
    for (const phone of [...survivor.phones, ...merged.phones]) {
      const key = this.normalizePhone(phone.number);
      if (!phoneMap.has(key)) {
        phoneMap.set(key, phone);
      }
    }
    result.phones = Array.from(phoneMap.values());
    resolved.push('phones');

    // Name conflict - keep survivor's unless empty
    if (!survivor.name && merged.name) {
      result.name = merged.name;
      resolved.push('name');
    } else if (survivor.name !== merged.name && merged.name) {
      conflicted.push('name');
    }

    // Company - keep more recent or non-empty
    if (!survivor.currentCompany && merged.currentCompany) {
      result.currentCompany = merged.currentCompany;
      resolved.push('currentCompany');
    }

    // Notes - concatenate
    if (merged.notes) {
      result.notes = [survivor.notes, merged.notes].filter(Boolean).join('\n---\n');
      resolved.push('notes');
    }
  }

  // --------------------------------------------------------------------------
  // UTILITY METHODS
  // --------------------------------------------------------------------------

  private groupByType(entities: OntologyEntity[]): Map<string, OntologyEntity[]> {
    const groups = new Map<string, OntologyEntity[]>();

    for (const entity of entities) {
      if (!groups.has(entity.type)) {
        groups.set(entity.type, []);
      }
      groups.get(entity.type)!.push(entity);
    }

    return groups;
  }

  private compareNames(name1: string, name2: string): number {
    const n1 = name1.toLowerCase().trim();
    const n2 = name2.toLowerCase().trim();

    if (n1 === n2) return 1;

    const parts1 = n1.split(/\s+/);
    const parts2 = n2.split(/\s+/);

    let matchingParts = 0;
    for (const p1 of parts1) {
      for (const p2 of parts2) {
        if (p1 === p2 || this.stringSimilarity(p1, p2) > 0.8) {
          matchingParts++;
          break;
        }
      }
    }

    return matchingParts / Math.max(parts1.length, parts2.length);
  }

  private stringSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1;
    if (s1.length === 0 || s2.length === 0) return 0;

    // Levenshtein distance
    const matrix: number[][] = [];

    for (let i = 0; i <= s1.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= s2.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= s1.length; i++) {
      for (let j = 1; j <= s2.length; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    const distance = matrix[s1.length][s2.length];
    return 1 - distance / Math.max(s1.length, s2.length);
  }

  private normalizePhone(phone: string): string {
    return phone.replace(/[^0-9]/g, '');
  }

  private normalizeUrl(url: string): string {
    return url
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '');
  }

  /**
   * Soundex phonetic encoding
   */
  private soundex(str: string): string {
    const s = str.toUpperCase().replace(/[^A-Z]/g, '');
    if (s.length === 0) return '';

    const codes: Record<string, string> = {
      B: '1', F: '1', P: '1', V: '1',
      C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
      D: '3', T: '3',
      L: '4',
      M: '5', N: '5',
      R: '6',
    };

    let result = s[0];
    let prevCode = codes[s[0]] || '';

    for (let i = 1; i < s.length && result.length < 4; i++) {
      const code = codes[s[i]] || '';
      if (code && code !== prevCode) {
        result += code;
        prevCode = code;
      } else if (!code) {
        prevCode = '';
      }
    }

    return (result + '000').slice(0, 4);
  }

  /**
   * Metaphone phonetic encoding (simplified)
   */
  private metaphone(str: string): string {
    // Simplified metaphone - just use soundex for now
    return this.soundex(str);
  }

  /**
   * Generate n-grams from string
   */
  private ngrams(str: string, n: number): string[] {
    const result: string[] = [];
    for (let i = 0; i <= str.length - n; i++) {
      result.push(str.slice(i, i + n));
    }
    return result;
  }

  // --------------------------------------------------------------------------
  // PUBLIC API
  // --------------------------------------------------------------------------

  /**
   * Find potential duplicates for a given entity
   */
  async findDuplicates(entityId: string): Promise<EntityMatch[]> {
    const entityManager = getEntityManager();
    const entity = await entityManager.get(entityId);

    if (!entity) {
      return [];
    }

    // Get entities of same type
    const store = getOntologyStore();
    const candidates = store.search(entity.type, 1000)
      .filter(e => e.id !== entityId);

    const matches: EntityMatch[] = [];

    for (const candidate of candidates) {
      const fullCandidate = await entityManager.get(candidate.id);
      if (!fullCandidate) continue;

      const match = await this.compareEntities(entity.type, entity, fullCandidate);
      if (match) {
        matches.push(match);
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get current session status
   */
  getSession(): ResolutionSession | null {
    return this.currentSession;
  }

  /**
   * Get merge history
   */
  getMergeHistory(): Map<string, string> {
    return new Map(this.mergeHistory);
  }

  /**
   * Resolve a merged entity ID to its survivor
   */
  resolveMergedId(mergedId: string): string {
    return this.mergeHistory.get(mergedId) || mergedId;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: EntityResolutionEngine | null = null;

export function getEntityResolutionEngine(): EntityResolutionEngine {
  if (!instance) {
    instance = new EntityResolutionEngine();
  }
  return instance;
}
