/**
 * Atlas Desktop - Embedding Generation
 * Converts text to vector embeddings for semantic search
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { getConfig } from '../../config';

const logger = createModuleLogger('Embeddings');

/**
 * Embedding provider type
 */
export type EmbeddingProvider = 'openai' | 'local' | 'none';

/**
 * Embedding configuration
 */
export interface EmbeddingConfig {
  /** Preferred provider */
  provider: EmbeddingProvider;
  /** OpenAI model for embeddings */
  openaiModel: string;
  /** Embedding dimensions (should match vector store) */
  dimensions: number;
  /** Cache embeddings in memory */
  enableCache: boolean;
  /** Maximum cache size */
  maxCacheSize: number;
  /** Batch size for batch operations */
  batchSize: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: EmbeddingConfig = {
  provider: 'local', // Default to local for offline support
  openaiModel: 'text-embedding-3-small',
  dimensions: 384,
  enableCache: true,
  maxCacheSize: 10000,
  batchSize: 100,
};

/**
 * Embedding result
 */
export interface EmbeddingResult {
  /** The embedding vector */
  vector: number[];
  /** Provider used */
  provider: EmbeddingProvider;
  /** Whether result was cached */
  cached: boolean;
  /** Processing time in ms */
  processingTime: number;
}

/**
 * Embedding events
 */
export interface EmbeddingEvents {
  'embedding-generated': (text: string, vector: number[]) => void;
  'provider-changed': (oldProvider: EmbeddingProvider, newProvider: EmbeddingProvider) => void;
  'cache-hit': (text: string) => void;
  error: (error: Error) => void;
}

/**
 * Simple hash function for cache keys
 */
function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

/**
 * Embedding Generator
 * Generates vector embeddings for text using various providers
 */
export class EmbeddingGenerator extends EventEmitter {
  private config: EmbeddingConfig;
  private cache: Map<string, number[]> = new Map();
  private currentProvider: EmbeddingProvider = 'none';
  private openaiClient: OpenAIEmbedder | null = null;
  private localEmbedder: LocalEmbedder | null = null;

  constructor(config?: Partial<EmbeddingConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('EmbeddingGenerator created', { config: this.config });
  }

  /**
   * Initialize the embedding generator
   */
  async initialize(): Promise<void> {
    // Try to initialize based on preferred provider
    if (this.config.provider === 'openai') {
      const initialized = await this.initializeOpenAI();
      if (initialized) {
        this.currentProvider = 'openai';
        return;
      }
    }

    // Fall back to local embeddings
    await this.initializeLocal();
    this.currentProvider = 'local';

    logger.info('EmbeddingGenerator initialized', { provider: this.currentProvider });
  }

  /**
   * Initialize OpenAI embeddings
   */
  private async initializeOpenAI(): Promise<boolean> {
    try {
      const config = getConfig();
      // Check for OpenRouter API key (uses OpenAI-compatible API)
      if (!config.openrouterApiKey) {
        logger.debug('OpenAI embeddings not available: no API key');
        return false;
      }

      this.openaiClient = new OpenAIEmbedder(
        config.openrouterApiKey,
        this.config.openaiModel,
        this.config.dimensions
      );

      logger.info('OpenAI embeddings initialized');
      return true;
    } catch (error) {
      logger.warn('Failed to initialize OpenAI embeddings', {
        error: (error as Error).message,
      });
      return false;
    }
  }

  /**
   * Initialize local embeddings
   */
  private async initializeLocal(): Promise<void> {
    this.localEmbedder = new LocalEmbedder(this.config.dimensions);
    logger.info('Local embeddings initialized');
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<EmbeddingResult> {
    const startTime = Date.now();
    const normalizedText = text.trim().toLowerCase();

    // Check cache
    if (this.config.enableCache) {
      const cacheKey = hashText(normalizedText);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.emit('cache-hit', text);
        return {
          vector: cached,
          provider: this.currentProvider,
          cached: true,
          processingTime: Date.now() - startTime,
        };
      }
    }

    // Generate embedding
    let vector: number[];

    if (this.currentProvider === 'openai' && this.openaiClient) {
      try {
        vector = await this.openaiClient.embed(text);
      } catch (error) {
        logger.warn('OpenAI embedding failed, falling back to local', {
          error: (error as Error).message,
        });
        // Fall back to local
        if (!this.localEmbedder) {
          await this.initializeLocal();
        }
        vector = this.localEmbedder!.embed(text);
      }
    } else if (this.localEmbedder) {
      vector = this.localEmbedder.embed(text);
    } else {
      throw new Error('No embedding provider available');
    }

    // Cache result
    if (this.config.enableCache) {
      const cacheKey = hashText(normalizedText);
      this.addToCache(cacheKey, vector);
    }

    this.emit('embedding-generated', text, vector);

    return {
      vector,
      provider: this.currentProvider,
      cached: false,
      processingTime: Date.now() - startTime,
    };
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += this.config.batchSize) {
      const batch = texts.slice(i, i + this.config.batchSize);
      const batchResults = await Promise.all(batch.map((text) => this.embed(text)));
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Add to cache with LRU eviction
   */
  private addToCache(key: string, vector: number[]): void {
    // Evict oldest entries if cache is full
    while (this.cache.size >= this.config.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      } else {
        break;
      }
    }
    this.cache.set(key, vector);
  }

  /**
   * Calculate similarity between two vectors (cosine similarity)
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vector dimension mismatch');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (normA * normB);
  }

  /**
   * Get current provider
   */
  getProvider(): EmbeddingProvider {
    return this.currentProvider;
  }

  /**
   * Switch provider
   */
  async switchProvider(provider: EmbeddingProvider): Promise<boolean> {
    if (provider === this.currentProvider) return true;

    const oldProvider = this.currentProvider;

    if (provider === 'openai') {
      const success = await this.initializeOpenAI();
      if (!success) return false;
      this.currentProvider = 'openai';
    } else if (provider === 'local') {
      await this.initializeLocal();
      this.currentProvider = 'local';
    }

    this.emit('provider-changed', oldProvider, this.currentProvider);
    return true;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number; hitRate: number } {
    return {
      size: this.cache.size,
      maxSize: this.config.maxCacheSize,
      hitRate: 0, // Would need to track hits/misses for accurate rate
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug('Embedding cache cleared');
  }

  /**
   * Shutdown
   */
  shutdown(): void {
    this.cache.clear();
    this.removeAllListeners();
    logger.info('EmbeddingGenerator shutdown');
  }

  // Type-safe event emitter methods
  on<K extends keyof EmbeddingEvents>(event: K, listener: EmbeddingEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof EmbeddingEvents>(event: K, listener: EmbeddingEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof EmbeddingEvents>(
    event: K,
    ...args: Parameters<EmbeddingEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * OpenAI Embedder
 * Uses OpenAI API for embeddings
 */
class OpenAIEmbedder {
  private apiKey: string;
  private model: string;
  private dimensions: number;

  constructor(apiKey: string, model: string, dimensions: number) {
    this.apiKey = apiKey;
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data[0].embedding;
  }
}

/**
 * Local Embedder
 * Simple TF-IDF-like embeddings for offline operation
 * This is a lightweight fallback - not as good as neural embeddings
 */
class LocalEmbedder {
  private dimensions: number;
  private vocabulary: Map<string, number> = new Map();
  private idf: Map<string, number> = new Map();
  private documentCount = 0;

  constructor(dimensions: number) {
    this.dimensions = dimensions;
    this.initializeVocabulary();
  }

  /**
   * Initialize with common English words for basic semantic coverage
   */
  private initializeVocabulary(): void {
    const commonWords = [
      // Action words
      'help',
      'find',
      'show',
      'get',
      'set',
      'create',
      'delete',
      'update',
      'open',
      'close',
      'start',
      'stop',
      'run',
      'execute',
      'save',
      'load',
      'send',
      'receive',
      'search',
      'browse',
      // Objects
      'file',
      'folder',
      'document',
      'image',
      'video',
      'music',
      'email',
      'message',
      'calendar',
      'reminder',
      'task',
      'note',
      'list',
      'setting',
      'preference',
      // Descriptors
      'new',
      'old',
      'recent',
      'important',
      'urgent',
      'favorite',
      'like',
      'want',
      'need',
      'remember',
      'forget',
      // Context
      'today',
      'tomorrow',
      'yesterday',
      'week',
      'month',
      'year',
      'morning',
      'evening',
      'night',
      // Question words
      'what',
      'where',
      'when',
      'why',
      'how',
      'who',
      'which',
      // Personal
      'my',
      'your',
      'name',
      'birthday',
      'work',
      'home',
      'family',
      'friend',
      // Technical
      'code',
      'program',
      'bug',
      'error',
      'install',
      'download',
      'upload',
      'connect',
      'server',
      'database',
      // Emotions
      'good',
      'bad',
      'great',
      'terrible',
      'happy',
      'sad',
      'angry',
      'excited',
      'thank',
      // Commands
      'please',
      'can',
      'could',
      'would',
      'should',
      'must',
      'will',
      'may',
    ];

    // Assign indices to words
    for (let i = 0; i < commonWords.length && i < this.dimensions; i++) {
      this.vocabulary.set(commonWords[i], i);
      this.idf.set(commonWords[i], 1.0); // Initial IDF
    }
  }

  /**
   * Tokenize text into words
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1);
  }

  /**
   * Generate embedding for text
   */
  embed(text: string): number[] {
    const tokens = this.tokenize(text);
    const vector = new Array(this.dimensions).fill(0);

    // Count term frequencies
    const tf: Map<string, number> = new Map();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    // Build TF-IDF vector
    for (const [word, count] of tf) {
      const index = this.vocabulary.get(word);
      if (index !== undefined && index < this.dimensions) {
        const idf = this.idf.get(word) || 1.0;
        vector[index] = (count / tokens.length) * idf;
      } else {
        // Hash unknown words to dimensions
        const hash = this.hashWord(word);
        vector[hash % this.dimensions] += count / tokens.length;
      }
    }

    // Add position-based features for word order
    for (let i = 0; i < Math.min(tokens.length, 10); i++) {
      const posIndex = this.dimensions - 10 + i;
      if (posIndex >= 0 && posIndex < this.dimensions) {
        const wordHash = this.hashWord(tokens[i]);
        vector[posIndex] = (wordHash % 100) / 100;
      }
    }

    // Normalize vector
    return this.normalize(vector);
  }

  /**
   * Simple hash for unknown words
   */
  private hashWord(word: string): number {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = (hash << 5) - hash + word.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  /**
   * Normalize vector to unit length
   */
  private normalize(vector: number[]): number[] {
    let norm = 0;
    for (const v of vector) {
      norm += v * v;
    }
    norm = Math.sqrt(norm);

    if (norm === 0) {
      // Return small random values if empty
      return vector.map(() => Math.random() * 0.01);
    }

    return vector.map((v) => v / norm);
  }
}

// Singleton instance
let embeddingGenerator: EmbeddingGenerator | null = null;

/**
 * Get or create the embedding generator instance
 */
export async function getEmbeddingGenerator(
  config?: Partial<EmbeddingConfig>
): Promise<EmbeddingGenerator> {
  if (!embeddingGenerator) {
    embeddingGenerator = new EmbeddingGenerator(config);
    await embeddingGenerator.initialize();
  }
  return embeddingGenerator;
}

/**
 * Shutdown the embedding generator
 */
export function shutdownEmbeddingGenerator(): void {
  if (embeddingGenerator) {
    embeddingGenerator.shutdown();
    embeddingGenerator = null;
  }
}

export default EmbeddingGenerator;
