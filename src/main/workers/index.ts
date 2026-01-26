/**
 * Atlas Desktop - Worker Threads Module
 * Exports worker pool and utilities for CPU-intensive task offloading
 */

export {
  WorkerPool,
  getWorkerPool,
  shutdownWorkerPool,
} from './worker-pool';

// Re-export types
export type {
  WorkerPoolConfig,
  WorkerPoolStats,
  WorkerPoolEvents,
  WorkerStatus,
  WorkerType,
  WorkerMessage,
  WorkerResponse,
  AudioWorkerOperation,
  AudioWorkerPayload,
  AudioWorkerResult,
  AudioProcessingConfig,
  AudioSpectrumData,
  AudioProcessingMetadata,
  EmbeddingWorkerOperation,
  EmbeddingWorkerPayload,
  EmbeddingWorkerResult,
  EmbeddingConfig,
} from '../../shared/types/workers';

export {
  DEFAULT_WORKER_POOL_CONFIG,
  DEFAULT_AUDIO_PROCESSING_CONFIG,
  DEFAULT_EMBEDDING_CONFIG,
  generateMessageId,
} from '../../shared/types/workers';
