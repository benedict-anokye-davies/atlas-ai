/**
 * Entity Resolution Types
 */

import { OntologyEntity, EntityType } from '../types';

// ============================================================================
// MATCH TYPES
// ============================================================================

/**
 * Represents a potential match between two entities
 */
export interface EntityMatch {
  entity1Id: string;
  entity2Id: string;
  entityType: EntityType;
  confidence: number;
  matchReasons: MatchReason[];
  suggestedAction: 'merge' | 'link' | 'ignore';
}

/**
 * Reason for a match
 */
export interface MatchReason {
  field: string;
  type: 'exact' | 'fuzzy' | 'semantic' | 'transitive';
  score: number;
  details: string;
}

// ============================================================================
// MERGE TYPES
// ============================================================================

/**
 * Result of merging two entities
 */
export interface MergeResult {
  success: boolean;
  survivorId: string;
  mergedId: string;
  fieldsConflicted: string[];
  fieldsResolved: string[];
  newEntity: OntologyEntity;
}

/**
 * Strategy for resolving field conflicts during merge
 */
export type MergeStrategy =
  | 'keep_first'
  | 'keep_second'
  | 'keep_most_recent'
  | 'keep_highest_confidence'
  | 'union'
  | 'custom';

/**
 * Configuration for entity merging
 */
export interface MergeConfig {
  strategy: MergeStrategy;
  fieldPriorities?: Record<string, 'first' | 'second' | 'union'>;
  preserveHistory?: boolean;
}

// ============================================================================
// BLOCKING TYPES
// ============================================================================

/**
 * Blocking configuration to reduce comparison space
 */
export interface BlockingConfig {
  keys: BlockingKey[];
  maxBlockSize: number;
}

/**
 * Blocking key definition
 */
export interface BlockingKey {
  name: string;
  fields: string[];
  transform?: 'lowercase' | 'soundex' | 'metaphone' | 'ngram' | 'prefix';
  ngramSize?: number;
  prefixLength?: number;
}

// ============================================================================
// RESOLUTION SESSION
// ============================================================================

/**
 * Resolution session state
 */
export interface ResolutionSession {
  id: string;
  startedAt: Date;
  completedAt?: Date;
  entityType?: EntityType;
  totalEntities: number;
  blocksGenerated: number;
  comparisonsPerformed: number;
  matchesFound: number;
  mergesExecuted: number;
  status: 'running' | 'completed' | 'failed';
  error?: string;
}

// ============================================================================
// RESOLUTION CONFIG
// ============================================================================

/**
 * Entity resolution configuration
 */
export interface EntityResolutionConfig {
  blocking: BlockingConfig;
  matching: {
    minConfidence: number;
    fieldWeights: Record<string, number>;
    enableSemanticMatching: boolean;
    enableTransitiveMatching: boolean;
  };
  merging: MergeConfig;
  autoMergeThreshold: number;
  manualReviewThreshold: number;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

export const DEFAULT_RESOLUTION_CONFIG: EntityResolutionConfig = {
  blocking: {
    keys: [
      { name: 'email_domain', fields: ['emails.email'], transform: 'lowercase' },
      { name: 'name_prefix', fields: ['name'], transform: 'prefix', prefixLength: 3 },
      { name: 'phone_suffix', fields: ['phones.number'], transform: 'lowercase' },
    ],
    maxBlockSize: 1000,
  },
  matching: {
    minConfidence: 0.6,
    fieldWeights: {
      email: 0.4,
      phone: 0.3,
      name: 0.2,
      organization: 0.1,
    },
    enableSemanticMatching: true,
    enableTransitiveMatching: true,
  },
  merging: {
    strategy: 'keep_highest_confidence',
    preserveHistory: true,
  },
  autoMergeThreshold: 0.95,
  manualReviewThreshold: 0.7,
};
