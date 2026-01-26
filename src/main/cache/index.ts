/**
 * Atlas Desktop - Cache Module
 * Intelligent caching across the application
 */

// Export cache strategies
export {
  BaseCache,
  LRUCache,
  TTLCache,
  SemanticCache,
  FileSystemCache,
  MemoryAwareCache,
  type CacheEntry,
  type CacheEntryMeta,
  type CacheStatistics,
  type CacheEvents,
  type BaseCacheConfig,
  type TTLCacheConfig,
  type SemanticCacheConfig,
  type SemanticCacheEntry,
  type FileSystemCacheConfig,
  type MemoryAwareCacheConfig,
} from './strategies';

// Export cache manager
export {
  CacheManager,
  getCacheManager,
  shutdownCacheManager,
  getCacheManagerSync,
  type CacheType,
  type CacheManagerConfig,
  type CacheManagerEvents,
  type AggregatedCacheStats,
  type LLMCacheEntry,
  type EmbeddingCacheEntry,
} from './cache-manager';

// Default export
export { CacheManager as default } from './cache-manager';
