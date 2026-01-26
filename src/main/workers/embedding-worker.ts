/* eslint-disable no-console */
/**
 * Atlas Desktop - Embedding Generation Worker
 * Handles CPU-intensive embedding generation tasks in a separate thread
 *
 * This worker performs:
 * - Text tokenization
 * - TF-IDF based embedding generation
 * - Vector normalization
 * - Cosine similarity calculation
 * - Embedding caching
 */

import { parentPort, workerData } from 'worker_threads';
import {
  WorkerMessage,
  WorkerResponse,
  EmbeddingWorkerOperation,
  EmbeddingWorkerPayload,
  EmbeddingWorkerResult,
  EmbeddingConfig,
  DEFAULT_EMBEDDING_CONFIG,
} from '../../shared/types/workers';

// Worker metadata from main thread
const { workerId, workerType } = workerData || {
  workerId: 'embedding-worker',
  workerType: 'embedding',
};

/**
 * Embedding processor state
 */
interface EmbeddingProcessorState {
  // Configuration
  config: EmbeddingConfig;

  // Vocabulary for TF-IDF
  vocabulary: Map<string, number>;
  idf: Map<string, number>;
  documentCount: number;

  // Embedding cache (LRU)
  cache: Map<string, number[]>;
  cacheOrder: string[];

  // Statistics
  textsProcessed: number;
  cacheHits: number;
  cacheMisses: number;
  totalProcessingTime: number;
}

// Initialize processor state
const state: EmbeddingProcessorState = createInitialState();

/**
 * Create initial processor state
 */
function createInitialState(config?: EmbeddingConfig): EmbeddingProcessorState {
  const cfg = config || DEFAULT_EMBEDDING_CONFIG;

  const vocabulary = new Map<string, number>();
  const idf = new Map<string, number>();

  // Initialize vocabulary with common English words for semantic coverage
  initializeVocabulary(vocabulary, idf, cfg.dimensions);

  return {
    config: cfg,
    vocabulary,
    idf,
    documentCount: 0,
    cache: new Map(),
    cacheOrder: [],
    textsProcessed: 0,
    cacheHits: 0,
    cacheMisses: 0,
    totalProcessingTime: 0,
  };
}

/**
 * Initialize vocabulary with common words
 */
function initializeVocabulary(
  vocabulary: Map<string, number>,
  idf: Map<string, number>,
  dimensions: number
): void {
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
    'add',
    'remove',
    'edit',
    'copy',
    'move',
    'rename',
    'build',
    'deploy',
    'test',
    'debug',
    'compile',
    'install',
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
    'project',
    'code',
    'function',
    'class',
    'variable',
    'module',
    'package',
    'database',
    'table',
    'query',
    'api',
    'endpoint',
    'request',
    'response',
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
    'fast',
    'slow',
    'large',
    'small',
    'good',
    'bad',
    'great',
    'excellent',
    'poor',
    'high',
    'low',
    'first',
    'last',
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
    'hour',
    'minute',
    'second',
    'time',
    'date',
    'now',
    // Question words
    'what',
    'where',
    'when',
    'why',
    'how',
    'who',
    'which',
    'whose',
    // Personal
    'my',
    'your',
    'name',
    'birthday',
    'work',
    'home',
    'family',
    'friend',
    'user',
    'account',
    'profile',
    'password',
    'username',
    'email',
    'phone',
    // Technical
    'error',
    'warning',
    'info',
    'debug',
    'log',
    'trace',
    'stack',
    'memory',
    'cpu',
    'gpu',
    'disk',
    'network',
    'server',
    'client',
    'browser',
    'window',
    'process',
    'thread',
    'async',
    'sync',
    'stream',
    'buffer',
    'socket',
    'port',
    // Emotions
    'happy',
    'sad',
    'angry',
    'excited',
    'thank',
    'please',
    'sorry',
    'welcome',
    // Commands
    'can',
    'could',
    'would',
    'should',
    'must',
    'will',
    'may',
    'might',
    // Programming
    'function',
    'variable',
    'constant',
    'string',
    'number',
    'boolean',
    'array',
    'object',
    'null',
    'undefined',
    'true',
    'false',
    'if',
    'else',
    'for',
    'while',
    'return',
    'import',
    'export',
    'class',
    'interface',
    'type',
    // Common verbs
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'done',
    'make',
    'made',
    'take',
    'took',
    'give',
    'gave',
    // Connectors
    'and',
    'or',
    'but',
    'not',
    'with',
    'without',
    'from',
    'to',
    'in',
    'on',
    'at',
    'by',
    'for',
    'about',
    'into',
    'through',
    'during',
    'before',
    'after',
    // Quantifiers
    'all',
    'some',
    'any',
    'many',
    'few',
    'most',
    'more',
    'less',
    'each',
    'every',
    'no',
    'none',
    'one',
    'two',
    'three',
    'several',
    'multiple',
    'single',
    'double',
  ];

  // Assign indices to words (up to dimensions)
  for (let i = 0; i < commonWords.length && i < dimensions - 10; i++) {
    vocabulary.set(commonWords[i], i);
    idf.set(commonWords[i], 1.0); // Initial IDF
  }
}

// ============================================================================
// Embedding Processing Functions
// ============================================================================

/**
 * Simple hash function for cache keys and unknown word hashing
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
 * Hash a word to a numeric value
 */
function hashWord(word: string): number {
  let hash = 0;
  for (let i = 0; i < word.length; i++) {
    hash = (hash << 5) - hash + word.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Tokenize text into words
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

/**
 * Normalize a vector to unit length
 */
function normalizeVector(vector: number[]): number[] {
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

/**
 * Generate embedding for text using TF-IDF
 */
function embedText(text: string): number[] {
  const tokens = tokenize(text);
  const dimensions = state.config.dimensions;
  const vector = new Array(dimensions).fill(0);

  // Count term frequencies
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }

  // Build TF-IDF vector
  for (const [word, count] of tf) {
    const index = state.vocabulary.get(word);
    if (index !== undefined && index < dimensions) {
      const idf = state.idf.get(word) || 1.0;
      vector[index] = (count / tokens.length) * idf;
    } else {
      // Hash unknown words to dimensions
      const hash = hashWord(word);
      const hashIndex = hash % (dimensions - 10); // Reserve last 10 for position
      vector[hashIndex] += count / tokens.length;
    }
  }

  // Add position-based features for word order
  if (state.config.usePositionEncoding) {
    for (let i = 0; i < Math.min(tokens.length, 10); i++) {
      const posIndex = dimensions - 10 + i;
      if (posIndex >= 0 && posIndex < dimensions) {
        const wordHash = hashWord(tokens[i]);
        vector[posIndex] = (wordHash % 100) / 100;
      }
    }
  }

  // Normalize if configured
  if (state.config.normalizeOutput) {
    return normalizeVector(vector);
  }

  return vector;
}

/**
 * Generate embedding with caching
 */
function embedWithCache(text: string): { vector: number[]; cached: boolean } {
  const normalizedText = text.trim().toLowerCase();
  const cacheKey = hashText(normalizedText);

  // Check cache
  if (state.config.enableCache) {
    const cached = state.cache.get(cacheKey);
    if (cached) {
      state.cacheHits++;
      // Move to end of order (LRU)
      const idx = state.cacheOrder.indexOf(cacheKey);
      if (idx > -1) {
        state.cacheOrder.splice(idx, 1);
        state.cacheOrder.push(cacheKey);
      }
      return { vector: cached, cached: true };
    }
  }

  state.cacheMisses++;

  // Generate embedding
  const vector = embedText(normalizedText);

  // Add to cache
  if (state.config.enableCache) {
    addToCache(cacheKey, vector);
  }

  state.textsProcessed++;
  return { vector, cached: false };
}

/**
 * Add to cache with LRU eviction
 */
function addToCache(key: string, vector: number[]): void {
  // Evict oldest entries if cache is full
  while (state.cache.size >= state.config.maxCacheSize) {
    const oldest = state.cacheOrder.shift();
    if (oldest) {
      state.cache.delete(oldest);
    } else {
      break;
    }
  }

  state.cache.set(key, vector);
  state.cacheOrder.push(key);
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
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
 * Embed multiple texts in batch
 */
function embedBatch(texts: string[]): { vectors: number[][]; cachedCount: number } {
  const vectors: number[][] = [];
  let cachedCount = 0;

  for (const text of texts) {
    const result = embedWithCache(text);
    vectors.push(result.vector);
    if (result.cached) cachedCount++;
  }

  return { vectors, cachedCount };
}

/**
 * Clear the embedding cache
 */
function clearCache(): void {
  state.cache.clear();
  state.cacheOrder = [];
  state.cacheHits = 0;
  state.cacheMisses = 0;
}

// ============================================================================
// Message Handling
// ============================================================================

/**
 * Handle incoming messages from the main thread
 */
function handleMessage(
  message: WorkerMessage<EmbeddingWorkerPayload>
): WorkerResponse<EmbeddingWorkerResult> {
  const startTime = performance.now();
  const operation = message.type as EmbeddingWorkerOperation;

  try {
    let result: EmbeddingWorkerResult;

    // Update config if provided
    if (message.payload.config) {
      state.config = { ...state.config, ...message.payload.config };
    }

    switch (operation) {
      case 'embed-text': {
        if (!message.payload.text) {
          throw new Error('No text provided for embedding');
        }
        const embedResult = embedWithCache(message.payload.text);
        result = {
          vector: embedResult.vector,
          cached: embedResult.cached,
        };
        break;
      }

      case 'embed-batch': {
        if (!message.payload.texts || message.payload.texts.length === 0) {
          throw new Error('No texts provided for batch embedding');
        }
        const batchResult = embedBatch(message.payload.texts);
        result = {
          vectors: batchResult.vectors,
          cached: batchResult.cachedCount === message.payload.texts.length,
        };
        break;
      }

      case 'calculate-similarity': {
        if (!message.payload.vectorA || !message.payload.vectorB) {
          throw new Error('Both vectors required for similarity calculation');
        }
        result = {
          similarity: cosineSimilarity(message.payload.vectorA, message.payload.vectorB),
        };
        break;
      }

      case 'tokenize': {
        if (!message.payload.text) {
          throw new Error('No text provided for tokenization');
        }
        const tokens = tokenize(message.payload.text);
        result = {
          tokens,
          tokenCount: tokens.length,
        };
        break;
      }

      case 'normalize-vector': {
        if (!message.payload.vectorA) {
          throw new Error('No vector provided for normalization');
        }
        result = {
          vector: normalizeVector(message.payload.vectorA),
        };
        break;
      }

      case 'clear-cache': {
        clearCache();
        result = {};
        break;
      }

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    const processingTime = performance.now() - startTime;
    state.totalProcessingTime += processingTime;

    return {
      id: message.id,
      success: true,
      result,
      processingTime,
      timestamp: Date.now(),
    };
  } catch (error) {
    const processingTime = performance.now() - startTime;

    return {
      id: message.id,
      success: false,
      error: (error as Error).message,
      processingTime,
      timestamp: Date.now(),
    };
  }
}

// ============================================================================
// Worker Entry Point
// ============================================================================

if (parentPort) {
  // Listen for messages from the main thread
  parentPort.on('message', (message: WorkerMessage<EmbeddingWorkerPayload>) => {
    const response = handleMessage(message);
    parentPort!.postMessage(response);
  });

  // Signal that worker is ready
  console.log(`[EmbeddingWorker] ${workerId} (${workerType}) initialized`);
}

export {
  handleMessage,
  embedText,
  embedWithCache,
  embedBatch,
  tokenize,
  normalizeVector,
  cosineSimilarity,
  clearCache,
};
