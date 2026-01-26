/**
 * Atlas Desktop - Fact Extractor
 * Extracts structured facts from conversations using LLM and pattern matching
 *
 * Features:
 * - LLM-based fact extraction for complex statements
 * - Pattern-based extraction for common patterns (fallback)
 * - Entity and relationship extraction
 * - Confidence scoring with multiple factors
 * - Fact deduplication and merging
 * - Contradiction detection and resolution
 * - Topic-based fact querying
 * - Source tracking for provenance
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import {
  KnowledgeStore,
  KnowledgeCategory,
  KnowledgeEntry,
  getKnowledgeStore,
} from './knowledge-store';
import { getLLMManager } from '../llm/manager';
import type { LLMManager } from '../llm/manager';

const logger = createModuleLogger('FactExtractor');

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Entity types for fact extraction
 */
export type EntityType =
  | 'person'
  | 'organization'
  | 'location'
  | 'datetime'
  | 'quantity'
  | 'concept'
  | 'object'
  | 'action'
  | 'attribute';

/**
 * Relationship types between entities
 */
export type RelationshipType =
  | 'is_a'
  | 'has'
  | 'located_in'
  | 'works_at'
  | 'prefers'
  | 'dislikes'
  | 'knows'
  | 'uses'
  | 'performs'
  | 'belongs_to'
  | 'related_to'
  | 'created_by'
  | 'occurs_at'
  | 'custom';

/**
 * Extracted entity from text
 */
export interface ExtractedEntity {
  /** Entity text */
  text: string;
  /** Normalized form */
  normalizedText: string;
  /** Entity type */
  type: EntityType;
  /** Confidence score (0-1) */
  confidence: number;
  /** Start position in source text */
  startPos?: number;
  /** End position in source text */
  endPos?: number;
  /** Additional attributes */
  attributes?: Record<string, unknown>;
}

/**
 * Relationship between entities
 */
export interface ExtractedRelationship {
  /** Source entity */
  source: ExtractedEntity;
  /** Target entity */
  target: ExtractedEntity;
  /** Relationship type */
  type: RelationshipType;
  /** Custom relationship label */
  label?: string;
  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * Extracted fact before storing
 */
export interface ExtractedFact {
  /** Knowledge category */
  category: KnowledgeCategory;
  /** Subject of the fact */
  subject: string;
  /** Predicate/relationship */
  predicate: string;
  /** Object of the fact */
  object: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Source of the fact */
  source: 'conversation' | 'explicit' | 'llm_extracted';
  /** Related entities */
  entities?: ExtractedEntity[];
  /** Topic tags */
  topics?: string[];
  /** Original text that fact was extracted from */
  sourceText?: string;
  /** Timestamp of extraction */
  extractedAt?: number;
  /** Hash for deduplication */
  hash?: string;
}

/**
 * Fact with contradiction information
 */
export interface FactWithContradiction extends ExtractedFact {
  /** Whether this fact contradicts existing facts */
  hasContradiction: boolean;
  /** IDs of contradicting facts */
  contradictingFactIds?: string[];
  /** Resolution strategy used */
  resolutionStrategy?: 'keep_new' | 'keep_old' | 'merge' | 'both';
}

/**
 * Extraction result
 */
export interface ExtractionResult {
  /** All extracted facts */
  facts: ExtractedFact[];
  /** Successfully stored entries */
  stored: KnowledgeEntry[];
  /** Number of duplicates found */
  duplicates: number;
  /** Number of contradictions resolved */
  contradictions: number;
  /** Entities extracted */
  entities: ExtractedEntity[];
  /** Relationships extracted */
  relationships: ExtractedRelationship[];
  /** Processing time in ms */
  processingTimeMs: number;
  /** Whether LLM was used */
  usedLLM: boolean;
}

/**
 * Fact query options
 */
export interface FactQueryOptions {
  /** Filter by topic */
  topic?: string;
  /** Filter by topics (any match) */
  topics?: string[];
  /** Filter by subject */
  subject?: string;
  /** Filter by category */
  category?: KnowledgeCategory;
  /** Minimum confidence */
  minConfidence?: number;
  /** Maximum results */
  limit?: number;
  /** Include related facts */
  includeRelated?: boolean;
  /** Sort by field */
  sortBy?: 'confidence' | 'recency' | 'reinforcements';
}

/**
 * Fact extractor configuration
 */
export interface FactExtractorConfig {
  /** Minimum confidence to store facts */
  minConfidenceToStore: number;
  /** Maximum facts per extraction */
  maxFactsPerExtraction: number;
  /** Use LLM for extraction */
  useLLM: boolean;
  /** Model to use for extraction (optional) */
  llmModel?: string;
  /** Temperature for LLM extraction */
  llmTemperature?: number;
  /** Enable contradiction detection */
  enableContradictionDetection: boolean;
  /** Similarity threshold for deduplication */
  deduplicationThreshold: number;
  /** Enable entity extraction */
  enableEntityExtraction: boolean;
  /** Enable topic extraction */
  enableTopicExtraction: boolean;
  /** Batch size for LLM extraction */
  batchSize: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: FactExtractorConfig = {
  minConfidenceToStore: 0.5,
  maxFactsPerExtraction: 20,
  useLLM: true,
  llmTemperature: 0.3,
  enableContradictionDetection: true,
  deduplicationThreshold: 0.85,
  enableEntityExtraction: true,
  enableTopicExtraction: true,
  batchSize: 5,
};

/**
 * Fact extractor events
 */
export interface FactExtractorEvents {
  /** Fact extracted */
  'fact-extracted': (fact: ExtractedFact) => void;
  /** Fact stored */
  'fact-stored': (entry: KnowledgeEntry) => void;
  /** Contradiction detected */
  'contradiction-detected': (newFact: ExtractedFact, existingFacts: KnowledgeEntry[]) => void;
  /** Extraction complete */
  'extraction-complete': (result: ExtractionResult) => void;
  /** Error occurred */
  error: (error: Error, context?: string) => void;
}

// ============================================================================
// Pattern Definitions (Fallback)
// ============================================================================

/**
 * Pattern definition for regex-based extraction
 */
interface ExtractionPattern {
  pattern: RegExp;
  category: KnowledgeCategory;
  getSubject: (match: RegExpMatchArray) => string;
  getPredicate: (match: RegExpMatchArray) => string;
  getObject: (match: RegExpMatchArray) => string;
  baseConfidence: number;
  topics?: string[];
}

/**
 * Extraction patterns for fallback
 */
const EXTRACTION_PATTERNS: ExtractionPattern[] = [
  // User preferences: "I like X", "I love X", "I enjoy X"
  {
    pattern: /\bi\s+(?:really\s+)?(?:like|love|enjoy|prefer)\s+(?:to\s+)?(.+?)(?:\.|,|!|\?|$)/gi,
    category: 'user_preference',
    getSubject: () => 'user',
    getPredicate: () => 'likes',
    getObject: (m) => m[1].trim(),
    baseConfidence: 0.7,
    topics: ['preferences'],
  },
  // User dislikes
  {
    pattern:
      /\bi\s+(?:don'?t\s+(?:really\s+)?)?(?:like|hate|dislike|can'?t\s+stand)\s+(.+?)(?:\.|,|!|\?|$)/gi,
    category: 'user_preference',
    getSubject: () => 'user',
    getPredicate: () => 'dislikes',
    getObject: (m) => m[1].trim(),
    baseConfidence: 0.7,
    topics: ['preferences', 'dislikes'],
  },
  // User name
  {
    pattern: /\bmy\s+name\s+is\s+(\w+)/gi,
    category: 'user_fact',
    getSubject: () => 'user',
    getPredicate: () => 'is_named',
    getObject: (m) => m[1].trim(),
    baseConfidence: 0.9,
    topics: ['identity', 'personal'],
  },
  // Job/occupation
  {
    pattern: /\bi\s+(?:work\s+(?:as\s+)?(?:a\s+)?|'m\s+a\s+|am\s+a\s+)(\w+(?:\s+\w+)?)/gi,
    category: 'user_fact',
    getSubject: () => 'user',
    getPredicate: () => 'works_as',
    getObject: (m) => m[1].trim(),
    baseConfidence: 0.8,
    topics: ['work', 'career', 'profession'],
  },
  // Location
  {
    pattern: /\bi\s+(?:live\s+in|'m\s+from|am\s+from|come\s+from)\s+(.+?)(?:\.|,|!|\?|$)/gi,
    category: 'user_fact',
    getSubject: () => 'user',
    getPredicate: () => 'lives_in',
    getObject: (m) => m[1].trim(),
    baseConfidence: 0.8,
    topics: ['location', 'personal'],
  },
  // Has/Owns
  {
    pattern: /\bi\s+(?:have|own|got)\s+(?:a\s+)?(.+?)(?:\.|,|!|\?|$)/gi,
    category: 'user_fact',
    getSubject: () => 'user',
    getPredicate: () => 'has',
    getObject: (m) => m[1].trim(),
    baseConfidence: 0.6,
    topics: ['possessions'],
  },
  // Habits
  {
    pattern: /\bi\s+(?:usually|always|often|tend\s+to|typically)\s+(.+?)(?:\.|,|!|\?|$)/gi,
    category: 'user_habit',
    getSubject: () => 'user',
    getPredicate: () => 'usually',
    getObject: (m) => m[1].trim(),
    baseConfidence: 0.6,
    topics: ['habits', 'routines'],
  },
  // Daily routines
  {
    pattern: /\bevery\s+(?:morning|evening|night|day|week)\s+i\s+(.+?)(?:\.|,|!|\?|$)/gi,
    category: 'user_habit',
    getSubject: () => 'user',
    getPredicate: () => 'daily_habit',
    getObject: (m) => m[1].trim(),
    baseConfidence: 0.7,
    topics: ['habits', 'routines', 'schedule'],
  },
  // Favorites
  {
    pattern: /\bmy\s+favorite\s+(\w+)\s+is\s+(.+?)(?:\.|,|!|\?|$)/gi,
    category: 'user_preference',
    getSubject: () => 'user',
    getPredicate: (m) => `favorite_${m[1].toLowerCase()}`,
    getObject: (m) => m[2].trim(),
    baseConfidence: 0.85,
    topics: ['preferences', 'favorites'],
  },
  // Preferences comparison
  {
    pattern: /\bi\s+prefer\s+(.+?)\s+(?:over|to)\s+(.+?)(?:\.|,|!|\?|$)/gi,
    category: 'user_preference',
    getSubject: () => 'user',
    getPredicate: () => 'prefers',
    getObject: (m) => `${m[1].trim()} over ${m[2].trim()}`,
    baseConfidence: 0.75,
    topics: ['preferences', 'comparisons'],
  },
  // Skills/Knowledge
  {
    pattern: /\bi\s+(?:know|use|speak|understand)\s+(.+?)(?:\.|,|!|\?|$)/gi,
    category: 'user_fact',
    getSubject: () => 'user',
    getPredicate: () => 'knows',
    getObject: (m) => m[1].trim(),
    baseConfidence: 0.5,
    topics: ['skills', 'knowledge'],
  },
  // Explicit remember requests
  {
    pattern: /\b(?:remember|don'?t\s+forget)\s+(?:that\s+)?(.+?)(?:\.|,|!|\?|$)/gi,
    category: 'user_fact',
    getSubject: () => 'user',
    getPredicate: () => 'wants_remembered',
    getObject: (m) => m[1].trim(),
    baseConfidence: 0.9,
    topics: ['explicit_memory'],
  },
];

// ============================================================================
// LLM Prompts
// ============================================================================

const LLM_FACT_EXTRACTION_PROMPT = `You are an expert fact extraction system. Extract structured facts from the following conversation text.

For each fact, identify:
1. Subject: Who or what the fact is about (often "user" for personal statements)
2. Predicate: The relationship or action
3. Object: The value or target of the relationship
4. Category: One of: user_preference, user_fact, user_habit, world_fact, task_pattern, relationship
5. Confidence: How certain the fact is (0.0-1.0)
6. Topics: Relevant topic tags

Guidelines:
- Extract only clear, factual statements
- Ignore opinions or speculation
- User statements starting with "I" are about the user
- Look for preferences, personal facts, habits, and relationships
- Assign lower confidence to hedged statements ("maybe", "sometimes")
- Assign higher confidence to definitive statements ("always", "definitely")

Conversation text:
{text}

Respond with a JSON array of facts:
[
  {
    "subject": "user",
    "predicate": "likes",
    "object": "coffee",
    "category": "user_preference",
    "confidence": 0.8,
    "topics": ["preferences", "beverages"],
    "sourceText": "I really like coffee in the morning"
  }
]

Only return valid JSON. If no facts found, return an empty array [].`;

const LLM_ENTITY_EXTRACTION_PROMPT = `Extract named entities from the following text. Identify people, organizations, locations, dates, quantities, and concepts.

Text:
{text}

Respond with a JSON array of entities:
[
  {
    "text": "John Smith",
    "normalizedText": "john smith",
    "type": "person",
    "confidence": 0.9
  }
]

Entity types: person, organization, location, datetime, quantity, concept, object, action, attribute
Only return valid JSON. If no entities found, return an empty array [].`;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _LLM_CONTRADICTION_CHECK_PROMPT = `Check if the new fact contradicts any existing facts.

New fact:
{newFact}

Existing facts:
{existingFacts}

Respond with JSON:
{
  "hasContradiction": true/false,
  "contradictingFactIds": ["id1", "id2"],
  "explanation": "Brief explanation of the contradiction",
  "resolutionSuggestion": "keep_new" | "keep_old" | "merge" | "both"
}

Only return valid JSON.`;

// ============================================================================
// FactExtractor Class
// ============================================================================

/**
 * FactExtractor - Extracts structured facts from conversations
 * Uses LLM for intelligent extraction with pattern-based fallback
 */
export class FactExtractor extends EventEmitter {
  private config: FactExtractorConfig;
  private knowledgeStore: KnowledgeStore | null = null;
  private llmManager: LLMManager | null = null;
  private factHashes: Set<string> = new Set();
  private topicIndex: Map<string, Set<string>> = new Map(); // topic -> factIds

  constructor(config?: Partial<FactExtractorConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    logger.info('FactExtractor initialized', {
      useLLM: this.config.useLLM,
      minConfidenceToStore: this.config.minConfidenceToStore,
      enableContradictionDetection: this.config.enableContradictionDetection,
    });
  }

  /**
   * Get or initialize the knowledge store
   */
  private async getStore(): Promise<KnowledgeStore> {
    if (!this.knowledgeStore) {
      this.knowledgeStore = await getKnowledgeStore();
      await this.buildTopicIndex();
    }
    return this.knowledgeStore;
  }

  /**
   * Get or initialize the LLM manager
   */
  private getLLM(): LLMManager {
    if (!this.llmManager) {
      this.llmManager = getLLMManager();
    }
    return this.llmManager;
  }

  /**
   * Build topic index from existing knowledge
   */
  private async buildTopicIndex(): Promise<void> {
    if (!this.knowledgeStore) return;

    const entries = this.knowledgeStore.query({ limit: 10000 });
    for (const entry of entries) {
      if (entry.tags) {
        for (const tag of entry.tags) {
          if (!this.topicIndex.has(tag)) {
            this.topicIndex.set(tag, new Set());
          }
          this.topicIndex.get(tag)!.add(entry.id);
        }
      }
      // Add to hash set for deduplication
      const hash = this.computeFactHash(entry.subject, entry.predicate, entry.object);
      this.factHashes.add(hash);
    }

    logger.debug('Topic index built', { topics: this.topicIndex.size });
  }

  /**
   * Compute hash for fact deduplication
   */
  private computeFactHash(subject: string, predicate: string, object: string): string {
    const normalized = `${subject.toLowerCase().trim()}|${predicate.toLowerCase().trim()}|${object.toLowerCase().trim()}`;
    // Simple hash using string encoding
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  /**
   * Check if a fact is a duplicate
   */
  private isDuplicate(fact: ExtractedFact): boolean {
    const hash = this.computeFactHash(fact.subject, fact.predicate, fact.object);
    return this.factHashes.has(hash);
  }

  /**
   * Calculate similarity between two strings
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

    if (s1 === s2) return 1.0;

    // Simple Jaccard similarity on words
    const words1Array = s1.split(/\s+/);
    const words2Array = s2.split(/\s+/);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _words1Set = new Set(words1Array);
    const words2Set = new Set(words2Array);

    let intersectionCount = 0;
    for (const word of words1Array) {
      if (words2Set.has(word)) {
        intersectionCount++;
      }
    }

    // Union is all unique words from both
    const unionSet = new Set([...words1Array, ...words2Array]);

    return intersectionCount / unionSet.size;
  }

  /**
   * Find similar existing facts
   */
  private async findSimilarFacts(fact: ExtractedFact): Promise<KnowledgeEntry[]> {
    const store = await this.getStore();

    // Query by subject and predicate
    const candidates = store.query({
      subject: fact.subject,
      predicate: fact.predicate,
      limit: 20,
    });

    // Filter by similarity threshold
    return candidates.filter((entry) => {
      const similarity = this.calculateSimilarity(fact.object, entry.object);
      return similarity >= this.config.deduplicationThreshold;
    });
  }

  /**
   * Extract facts using LLM
   */
  private async extractFactsWithLLM(text: string): Promise<ExtractedFact[]> {
    try {
      const llm = this.getLLM();
      const prompt = LLM_FACT_EXTRACTION_PROMPT.replace('{text}', text);

      const response = await llm.chat(prompt, undefined, {
        tools: undefined,
        tool_choice: undefined,
      });

      // Parse JSON response
      const content = response.content.trim();
      const jsonMatch = content.match(/\[[\s\S]*\]/);

      if (!jsonMatch) {
        logger.warn('LLM did not return valid JSON for fact extraction');
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        subject: string;
        predicate: string;
        object: string;
        category: KnowledgeCategory;
        confidence: number;
        topics?: string[];
        sourceText?: string;
      }>;

      return parsed.map((f) => ({
        ...f,
        source: 'llm_extracted' as const,
        extractedAt: Date.now(),
        hash: this.computeFactHash(f.subject, f.predicate, f.object),
      }));
    } catch (error) {
      logger.warn('LLM fact extraction failed, falling back to patterns', {
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Extract entities using LLM
   */
  private async extractEntitiesWithLLM(text: string): Promise<ExtractedEntity[]> {
    if (!this.config.enableEntityExtraction) return [];

    try {
      const llm = this.getLLM();
      const prompt = LLM_ENTITY_EXTRACTION_PROMPT.replace('{text}', text);

      const response = await llm.chat(prompt);

      const content = response.content.trim();
      const jsonMatch = content.match(/\[[\s\S]*\]/);

      if (!jsonMatch) {
        return [];
      }

      return JSON.parse(jsonMatch[0]) as ExtractedEntity[];
    } catch (error) {
      logger.debug('Entity extraction failed', { error: (error as Error).message });
      return [];
    }
  }

  /**
   * Extract facts using pattern matching (fallback)
   */
  extractFactsWithPatterns(text: string): ExtractedFact[] {
    const facts: ExtractedFact[] = [];
    const seenFacts = new Set<string>();

    for (const pattern of EXTRACTION_PATTERNS) {
      // Reset regex lastIndex
      pattern.pattern.lastIndex = 0;

      let match;
      while ((match = pattern.pattern.exec(text)) !== null) {
        const subject = pattern.getSubject(match);
        const predicate = pattern.getPredicate(match);
        let object = pattern.getObject(match);

        // Clean and validate object
        object = this.cleanObject(object);
        if (!object || object.length < 2 || object.length > 100) {
          continue;
        }

        // Skip if already seen
        const factKey = `${subject}|${predicate}|${object}`.toLowerCase();
        if (seenFacts.has(factKey)) {
          continue;
        }
        seenFacts.add(factKey);

        // Calculate confidence
        const confidence = this.calculateConfidence(pattern.baseConfidence, match, text);

        facts.push({
          category: pattern.category,
          subject,
          predicate,
          object,
          confidence,
          source: 'conversation',
          topics: pattern.topics,
          sourceText: match[0],
          extractedAt: Date.now(),
          hash: this.computeFactHash(subject, predicate, object),
        });

        if (facts.length >= this.config.maxFactsPerExtraction) {
          break;
        }
      }

      if (facts.length >= this.config.maxFactsPerExtraction) {
        break;
      }
    }

    // Sort by confidence
    facts.sort((a, b) => b.confidence - a.confidence);

    return facts;
  }

  /**
   * Clean extracted object text
   */
  private cleanObject(text: string): string {
    return text
      .trim()
      .replace(/^(?:the|a|an|some|my)\s+/i, '')
      .replace(/[.,!?;:]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Calculate confidence score based on various factors
   */
  private calculateConfidence(
    baseConfidence: number,
    match: RegExpMatchArray,
    fullText: string
  ): number {
    let confidence = baseConfidence;

    // Boost for direct statements (not questions)
    if (!fullText.includes('?')) {
      confidence += 0.05;
    }

    // Boost for shorter, clearer statements
    if (match[0].length < 30) {
      confidence += 0.05;
    }

    // Boost for explicit language
    if (/really|definitely|always|absolutely/i.test(match[0])) {
      confidence += 0.1;
    }

    // Penalty for hedging language
    if (/maybe|sometimes|might|perhaps|probably/i.test(match[0])) {
      confidence -= 0.15;
    }

    // Penalty for negation complexity
    if (/not|n't|never/i.test(match[0])) {
      confidence -= 0.05;
    }

    // Clamp to valid range
    return Math.max(0.1, Math.min(1.0, confidence));
  }

  /**
   * Detect contradictions with existing facts
   */
  private async detectContradictions(
    fact: ExtractedFact
  ): Promise<{ hasContradiction: boolean; contradictingFacts: KnowledgeEntry[] }> {
    if (!this.config.enableContradictionDetection) {
      return { hasContradiction: false, contradictingFacts: [] };
    }

    const store = await this.getStore();

    // Find facts with same subject and predicate
    const candidates = store.query({
      subject: fact.subject,
      predicate: fact.predicate,
      minConfidenceScore: 0.5,
      limit: 10,
    });

    // Check for contradictions
    const contradictingFacts: KnowledgeEntry[] = [];

    for (const candidate of candidates) {
      // Same subject and predicate but different object
      if (candidate.object !== fact.object.toLowerCase().trim()) {
        // Check if this is truly a contradiction vs an addition
        // For example: "user likes coffee" and "user likes tea" are not contradictions
        // But "user's name is John" and "user's name is Mike" are

        const isExclusivePredicate = [
          'is_named',
          'works_as',
          'lives_in',
          'born_on',
          'age_is',
        ].includes(fact.predicate);

        if (isExclusivePredicate) {
          contradictingFacts.push(candidate);
        }
      }
    }

    if (contradictingFacts.length > 0) {
      this.emit('contradiction-detected', fact, contradictingFacts);
      logger.info('Contradiction detected', {
        newFact: `${fact.subject} ${fact.predicate} ${fact.object}`,
        existingCount: contradictingFacts.length,
      });
    }

    return {
      hasContradiction: contradictingFacts.length > 0,
      contradictingFacts,
    };
  }

  /**
   * Resolve contradictions
   */
  private async resolveContradiction(
    newFact: ExtractedFact,
    existingFacts: KnowledgeEntry[]
  ): Promise<'keep_new' | 'keep_old' | 'merge'> {
    // Simple resolution strategy based on confidence and recency
    const newConfidence = newFact.confidence;
    const maxExistingConfidence = Math.max(...existingFacts.map((f) => f.confidenceScore));

    // If new fact is significantly more confident, keep new
    if (newConfidence > maxExistingConfidence + 0.2) {
      // Mark old facts as outdated by reducing confidence
      const store = await this.getStore();
      for (const old of existingFacts) {
        const newScore = old.confidenceScore * 0.5;
        if (newScore < this.config.minConfidenceToStore) {
          store.removeKnowledge(old.id);
        }
      }
      return 'keep_new';
    }

    // If existing facts are more confident, keep old
    if (maxExistingConfidence > newConfidence + 0.2) {
      return 'keep_old';
    }

    // Otherwise, keep new (recency preference)
    return 'keep_new';
  }

  /**
   * Extract facts from text
   */
  async extractFacts(text: string): Promise<ExtractedFact[]> {
    const startTime = Date.now();
    let facts: ExtractedFact[] = [];

    // Try LLM extraction first if enabled
    if (this.config.useLLM) {
      try {
        facts = await this.extractFactsWithLLM(text);
        logger.debug('LLM extraction completed', { factCount: facts.length });
      } catch (error) {
        logger.warn('LLM extraction failed', { error: (error as Error).message });
      }
    }

    // Fall back to pattern extraction if LLM failed or returned no results
    if (facts.length === 0) {
      facts = this.extractFactsWithPatterns(text);
      logger.debug('Pattern extraction completed', { factCount: facts.length });
    }

    // Emit events for each fact
    for (const fact of facts) {
      this.emit('fact-extracted', fact);
    }

    logger.info('Fact extraction completed', {
      factCount: facts.length,
      processingTimeMs: Date.now() - startTime,
    });

    return facts;
  }

  /**
   * Extract and store facts from text
   */
  async extractAndStore(text: string): Promise<ExtractionResult> {
    const startTime = Date.now();
    const store = await this.getStore();

    // Extract facts
    const facts = await this.extractFacts(text);

    // Extract entities if enabled
    let entities: ExtractedEntity[] = [];
    if (this.config.enableEntityExtraction && this.config.useLLM) {
      entities = await this.extractEntitiesWithLLM(text);
    }

    const stored: KnowledgeEntry[] = [];
    let duplicates = 0;
    let contradictions = 0;

    for (const fact of facts) {
      // Skip low-confidence facts
      if (fact.confidence < this.config.minConfidenceToStore) {
        continue;
      }

      // Check for duplicates
      if (this.isDuplicate(fact)) {
        // Reinforce existing knowledge
        const similar = await this.findSimilarFacts(fact);
        if (similar.length > 0) {
          store.reinforceKnowledge(similar[0].id, fact.confidence * 0.1);
          duplicates++;
          continue;
        }
      }

      // Check for contradictions
      const { hasContradiction, contradictingFacts } = await this.detectContradictions(fact);

      if (hasContradiction) {
        contradictions++;
        const resolution = await this.resolveContradiction(fact, contradictingFacts);

        if (resolution === 'keep_old') {
          continue; // Skip storing new fact
        }
      }

      // Store the fact
      try {
        const entry = store.addKnowledge({
          category: fact.category,
          subject: fact.subject,
          predicate: fact.predicate,
          object: fact.object,
          source: fact.source === 'llm_extracted' ? 'inferred' : fact.source,
          confidenceScore: fact.confidence,
          tags: fact.topics,
          metadata: {
            sourceText: fact.sourceText,
            extractedAt: fact.extractedAt,
            entities: entities.filter(
              (e) =>
                fact.sourceText?.toLowerCase().includes(e.text.toLowerCase()) ||
                fact.object.toLowerCase().includes(e.text.toLowerCase())
            ),
          },
        });

        stored.push(entry);
        this.factHashes.add(
          fact.hash || this.computeFactHash(fact.subject, fact.predicate, fact.object)
        );

        // Update topic index
        if (fact.topics) {
          for (const topic of fact.topics) {
            if (!this.topicIndex.has(topic)) {
              this.topicIndex.set(topic, new Set());
            }
            this.topicIndex.get(topic)!.add(entry.id);
          }
        }

        this.emit('fact-stored', entry);
      } catch (error) {
        logger.warn('Failed to store fact', {
          error: (error as Error).message,
          fact,
        });
      }
    }

    const result: ExtractionResult = {
      facts,
      stored,
      duplicates,
      contradictions,
      entities,
      relationships: [], // Would be populated from entity relationships
      processingTimeMs: Date.now() - startTime,
      usedLLM: this.config.useLLM && facts.some((f) => f.source === 'llm_extracted'),
    };

    this.emit('extraction-complete', result);

    logger.info('Extraction and storage complete', {
      extracted: facts.length,
      stored: stored.length,
      duplicates,
      contradictions,
      processingTimeMs: result.processingTimeMs,
    });

    return result;
  }

  /**
   * Process a conversation turn
   */
  async processConversationTurn(
    userMessage: string,
    assistantResponse?: string
  ): Promise<ExtractionResult> {
    // Primarily extract from user message
    const result = await this.extractAndStore(userMessage);

    // Optionally extract from assistant response with lower confidence
    if (assistantResponse && this.config.useLLM) {
      const assistantFacts = await this.extractFacts(assistantResponse);

      // Only keep user-related facts from assistant response
      const userRelatedFacts = assistantFacts.filter(
        (f) => f.subject === 'user' || f.predicate.includes('user')
      );

      for (const fact of userRelatedFacts) {
        fact.confidence *= 0.6; // Lower confidence for inferred facts
        fact.source = 'conversation';
      }

      // Store with lower confidence
      for (const fact of userRelatedFacts) {
        if (fact.confidence >= this.config.minConfidenceToStore) {
          const store = await this.getStore();
          if (!this.isDuplicate(fact)) {
            store.addKnowledge({
              category: fact.category,
              subject: fact.subject,
              predicate: fact.predicate,
              object: fact.object,
              source: 'inferred',
              confidenceScore: fact.confidence,
              tags: fact.topics,
            });
          }
        }
      }
    }

    return result;
  }

  /**
   * Manually add an explicit fact
   */
  async addExplicitFact(
    category: KnowledgeCategory,
    subject: string,
    predicate: string,
    object: string,
    topics?: string[]
  ): Promise<KnowledgeEntry> {
    const store = await this.getStore();

    const entry = store.addKnowledge({
      category,
      subject,
      predicate,
      object,
      source: 'explicit',
      confidenceScore: 0.95, // High confidence for explicit facts
      tags: topics,
    });

    // Update indexes
    const hash = this.computeFactHash(subject, predicate, object);
    this.factHashes.add(hash);

    if (topics) {
      for (const topic of topics) {
        if (!this.topicIndex.has(topic)) {
          this.topicIndex.set(topic, new Set());
        }
        this.topicIndex.get(topic)!.add(entry.id);
      }
    }

    this.emit('fact-stored', entry);
    return entry;
  }

  /**
   * Query facts by topic
   */
  async queryByTopic(
    topic: string,
    options?: Partial<FactQueryOptions>
  ): Promise<KnowledgeEntry[]> {
    const store = await this.getStore();

    // Get fact IDs for this topic
    const factIds = this.topicIndex.get(topic.toLowerCase());

    if (!factIds || factIds.size === 0) {
      // Fall back to text search
      return store.query({
        text: topic,
        minConfidenceScore: options?.minConfidence,
        limit: options?.limit || 20,
        sortBy: options?.sortBy || 'confidence',
      });
    }

    // Get entries by IDs
    const entries: KnowledgeEntry[] = [];
    const factIdsArray = Array.from(factIds);
    for (const id of factIdsArray) {
      const entry = store.query({ text: id, limit: 1 })[0];
      if (entry) {
        entries.push(entry);
      }
    }

    // Apply additional filters
    let results = entries;

    if (options?.minConfidence) {
      results = results.filter((e) => e.confidenceScore >= options.minConfidence!);
    }

    if (options?.category) {
      results = results.filter((e) => e.category === options.category);
    }

    if (options?.subject) {
      results = results.filter((e) => e.subject.includes(options.subject!.toLowerCase()));
    }

    // Sort
    if (options?.sortBy === 'recency') {
      results.sort((a, b) => b.accessedAt - a.accessedAt);
    } else {
      results.sort((a, b) => b.confidenceScore - a.confidenceScore);
    }

    // Limit
    if (options?.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Query facts with options
   */
  async queryFacts(options: FactQueryOptions): Promise<KnowledgeEntry[]> {
    const store = await this.getStore();

    // If topic specified, use topic index
    if (options.topic) {
      return this.queryByTopic(options.topic, options);
    }

    // If multiple topics, find intersection
    if (options.topics && options.topics.length > 0) {
      let resultIds: Set<string> | null = null;

      for (const topic of options.topics) {
        const topicIds = this.topicIndex.get(topic.toLowerCase());
        if (topicIds) {
          if (resultIds === null) {
            resultIds = new Set(Array.from(topicIds));
          } else {
            const resultIdsArray = Array.from(resultIds);
            resultIds = new Set(resultIdsArray.filter((id) => topicIds.has(id)));
          }
        }
      }

      if (resultIds && resultIds.size > 0) {
        const entries: KnowledgeEntry[] = [];
        const resultIdsArray = Array.from(resultIds);
        for (const id of resultIdsArray) {
          const results = store.query({ text: id, limit: 1 });
          if (results.length > 0) {
            entries.push(results[0]);
          }
        }
        return entries.slice(0, options.limit || 20);
      }
    }

    // General query
    return store.query({
      category: options.category,
      subject: options.subject,
      minConfidenceScore: options.minConfidence,
      limit: options.limit || 20,
      sortBy: options.sortBy || 'confidence',
    });
  }

  /**
   * Update a fact (used when contradicted)
   */
  async updateFact(
    factId: string,
    updates: {
      object?: string;
      confidence?: number;
      topics?: string[];
    }
  ): Promise<KnowledgeEntry | null> {
    const store = await this.getStore();
    const existing = store.query({ text: factId, limit: 1 })[0];

    if (!existing) {
      return null;
    }

    // Remove old entry
    store.removeKnowledge(existing.id);

    // Create updated entry
    return store.addKnowledge({
      category: existing.category,
      subject: existing.subject,
      predicate: existing.predicate,
      object: updates.object || existing.object,
      source: existing.source,
      confidenceScore: updates.confidence || existing.confidenceScore,
      tags: updates.topics || existing.tags,
    });
  }

  /**
   * Get extraction statistics
   */
  async getStats(): Promise<{
    totalFacts: number;
    byCategory: Record<KnowledgeCategory, number>;
    byTopic: Record<string, number>;
    averageConfidence: number;
    topTopics: Array<{ topic: string; count: number }>;
  }> {
    const store = await this.getStore();
    const baseStats = store.getStats();

    // Calculate topic stats
    const topicCounts: Record<string, number> = {};
    for (const [topic, ids] of this.topicIndex) {
      topicCounts[topic] = ids.size;
    }

    // Get top topics
    const topTopics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic, count]) => ({ topic, count }));

    return {
      totalFacts: baseStats.totalEntries,
      byCategory: baseStats.byCategory,
      byTopic: topicCounts,
      averageConfidence: baseStats.averageConfidence,
      topTopics,
    };
  }

  /**
   * Clear all extracted facts
   */
  async clear(): Promise<void> {
    if (this.knowledgeStore) {
      await this.knowledgeStore.clear();
    }
    this.factHashes.clear();
    this.topicIndex.clear();
    logger.info('FactExtractor cleared');
  }

  /**
   * Shutdown the fact extractor
   */
  async shutdown(): Promise<void> {
    if (this.knowledgeStore) {
      await this.knowledgeStore.shutdown();
      this.knowledgeStore = null;
    }
    this.llmManager = null;
    this.factHashes.clear();
    this.topicIndex.clear();
    this.removeAllListeners();
    logger.info('FactExtractor shutdown');
  }

  // Type-safe event emitter methods
  on<K extends keyof FactExtractorEvents>(event: K, listener: FactExtractorEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof FactExtractorEvents>(event: K, listener: FactExtractorEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof FactExtractorEvents>(
    event: K,
    ...args: Parameters<FactExtractorEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// ============================================================================
// Singleton Management
// ============================================================================

let factExtractor: FactExtractor | null = null;

/**
 * Get or create the fact extractor instance
 */
export function getFactExtractor(config?: Partial<FactExtractorConfig>): FactExtractor {
  if (!factExtractor) {
    factExtractor = new FactExtractor(config);
  }
  return factExtractor;
}

/**
 * Shutdown the fact extractor
 */
export async function shutdownFactExtractor(): Promise<void> {
  if (factExtractor) {
    await factExtractor.shutdown();
    factExtractor = null;
  }
}

export default FactExtractor;
