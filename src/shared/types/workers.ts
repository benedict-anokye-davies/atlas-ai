/**
 * Atlas Desktop - Worker Thread Types
 * Type definitions for worker threads communication
 */

/**
 * Base message interface for worker communication
 */
export interface WorkerMessage<T = unknown> {
  /** Unique message ID for request-response correlation */
  id: string;
  /** Message type/action */
  type: string;
  /** Message payload */
  payload: T;
  /** Timestamp when message was created */
  timestamp: number;
}

/**
 * Worker response message
 */
export interface WorkerResponse<T = unknown> {
  /** Message ID from the original request */
  id: string;
  /** Whether the operation succeeded */
  success: boolean;
  /** Result data if successful */
  result?: T;
  /** Error message if failed */
  error?: string;
  /** Processing time in milliseconds */
  processingTime: number;
  /** Timestamp when response was created */
  timestamp: number;
}

/**
 * Worker status information
 */
export interface WorkerStatus {
  /** Worker ID */
  id: string;
  /** Worker type */
  type: WorkerType;
  /** Is worker currently busy */
  isBusy: boolean;
  /** Number of tasks processed */
  tasksProcessed: number;
  /** Total processing time in ms */
  totalProcessingTime: number;
  /** Average processing time in ms */
  averageProcessingTime: number;
  /** Number of errors encountered */
  errorCount: number;
  /** Last error message */
  lastError?: string;
  /** Worker uptime in ms */
  uptime: number;
  /** Memory usage in bytes (approximate) */
  memoryUsage: number;
}

/**
 * Worker types supported by the pool
 */
export type WorkerType = 'audio' | 'embedding';

/**
 * Worker pool configuration
 */
export interface WorkerPoolConfig {
  /** Number of audio workers to create */
  audioWorkers: number;
  /** Number of embedding workers to create */
  embeddingWorkers: number;
  /** Task timeout in milliseconds */
  taskTimeout: number;
  /** Maximum queue size per worker type */
  maxQueueSize: number;
  /** Enable performance monitoring */
  enableMonitoring: boolean;
  /** Monitoring interval in milliseconds */
  monitoringInterval: number;
  /** Auto-restart workers on crash */
  autoRestart: boolean;
  /** Maximum restart attempts before giving up */
  maxRestartAttempts: number;
  /** Restart cooldown in milliseconds */
  restartCooldown: number;
}

/**
 * Default worker pool configuration
 */
export const DEFAULT_WORKER_POOL_CONFIG: WorkerPoolConfig = {
  audioWorkers: 2,
  embeddingWorkers: 2,
  taskTimeout: 30000, // 30 seconds
  maxQueueSize: 100,
  enableMonitoring: true,
  monitoringInterval: 5000, // 5 seconds
  autoRestart: true,
  maxRestartAttempts: 3,
  restartCooldown: 1000, // 1 second
};

/**
 * Worker pool statistics
 */
export interface WorkerPoolStats {
  /** Pool uptime in milliseconds */
  uptime: number;
  /** Total tasks processed across all workers */
  totalTasksProcessed: number;
  /** Total errors across all workers */
  totalErrors: number;
  /** Current queue sizes by worker type */
  queueSizes: Record<WorkerType, number>;
  /** Worker statuses */
  workers: WorkerStatus[];
  /** Average task time by worker type */
  averageTaskTime: Record<WorkerType, number>;
  /** Tasks per second by worker type */
  tasksPerSecond: Record<WorkerType, number>;
}

/**
 * Worker pool events
 */
export interface WorkerPoolEvents {
  /** Worker started */
  'worker-started': (workerId: string, workerType: WorkerType) => void;
  /** Worker stopped */
  'worker-stopped': (workerId: string, workerType: WorkerType) => void;
  /** Worker crashed and will be restarted */
  'worker-crashed': (workerId: string, workerType: WorkerType, error: Error) => void;
  /** Worker restarted successfully */
  'worker-restarted': (workerId: string, workerType: WorkerType) => void;
  /** Task completed */
  'task-completed': (workerId: string, workerType: WorkerType, taskId: string, duration: number) => void;
  /** Task failed */
  'task-failed': (workerId: string, workerType: WorkerType, taskId: string, error: string) => void;
  /** Task timeout */
  'task-timeout': (workerId: string, workerType: WorkerType, taskId: string) => void;
  /** Queue full, task rejected */
  'queue-full': (workerType: WorkerType, taskId: string) => void;
  /** Stats updated */
  'stats-updated': (stats: WorkerPoolStats) => void;
  /** Error occurred */
  error: (error: Error) => void;
}

// ============================================================================
// Audio Worker Types
// ============================================================================

/**
 * Audio processing operation types
 */
export type AudioWorkerOperation =
  | 'process-frame' // Process a single audio frame
  | 'apply-high-pass' // Apply high-pass filter
  | 'apply-noise-gate' // Apply noise gate
  | 'apply-noise-reduction' // Apply noise reduction
  | 'apply-echo-cancellation' // Apply NLMS echo cancellation
  | 'calculate-rms' // Calculate RMS level
  | 'calculate-spectrum' // Calculate frequency spectrum
  | 'update-noise-estimate' // Update noise floor estimate
  | 'reset-filters'; // Reset all filter states

/**
 * Audio worker request message
 */
export interface AudioWorkerRequest extends WorkerMessage {
  type: AudioWorkerOperation;
  payload: AudioWorkerPayload;
}

/**
 * Audio worker payload types
 */
export interface AudioWorkerPayload {
  /** Audio samples as Float32Array (serialized) */
  samples?: ArrayBuffer;
  /** Sample count */
  sampleCount?: number;
  /** Sample rate */
  sampleRate?: number;
  /** Configuration parameters */
  config?: AudioProcessingConfig;
  /** Echo reference signal (for AEC) */
  echoReference?: ArrayBuffer;
}

/**
 * Audio processing configuration
 */
export interface AudioProcessingConfig {
  /** Enable noise gate */
  enableNoiseGate: boolean;
  /** Noise gate threshold in dB */
  noiseGateThreshold: number;
  /** Noise gate attack in ms */
  noiseGateAttack: number;
  /** Noise gate release in ms */
  noiseGateRelease: number;
  /** Enable noise reduction */
  enableNoiseReduction: boolean;
  /** Noise reduction strength (0-1) */
  noiseReductionStrength: number;
  /** Enable high-pass filter */
  enableHighPass: boolean;
  /** High-pass cutoff frequency in Hz */
  highPassCutoff: number;
  /** Enable echo cancellation */
  enableEchoCancellation: boolean;
  /** NLMS filter length */
  nlmsFilterLength: number;
  /** NLMS step size */
  nlmsStepSize: number;
  /** FFT size for spectrum analysis */
  fftSize: number;
}

/**
 * Default audio processing configuration
 */
export const DEFAULT_AUDIO_PROCESSING_CONFIG: AudioProcessingConfig = {
  enableNoiseGate: true,
  noiseGateThreshold: -40,
  noiseGateAttack: 5,
  noiseGateRelease: 50,
  enableNoiseReduction: true,
  noiseReductionStrength: 0.5,
  enableHighPass: true,
  highPassCutoff: 80,
  enableEchoCancellation: false,
  nlmsFilterLength: 1024,
  nlmsStepSize: 0.2,
  fftSize: 256,
};

/**
 * Audio worker result types
 */
export interface AudioWorkerResult {
  /** Processed audio samples (serialized) */
  samples?: ArrayBuffer;
  /** Sample count */
  sampleCount?: number;
  /** RMS level (0-1) */
  rmsLevel?: number;
  /** Frequency spectrum data */
  spectrum?: AudioSpectrumData;
  /** Noise floor estimate */
  noiseFloor?: number;
  /** Processing metadata */
  metadata?: AudioProcessingMetadata;
}

/**
 * Audio spectrum data from FFT analysis
 */
export interface AudioSpectrumData {
  /** Frequency bins */
  frequencies: number[];
  /** Magnitude values (0-1) */
  magnitudes: number[];
  /** Bass energy (0-200Hz) */
  bass: number;
  /** Low-mid energy (200-500Hz) */
  lowMid: number;
  /** Mid energy (500-2000Hz) */
  mid: number;
  /** High-mid energy (2000-4000Hz) */
  highMid: number;
  /** Treble energy (4000+Hz) */
  treble: number;
}

/**
 * Audio processing metadata
 */
export interface AudioProcessingMetadata {
  /** Whether noise gate was triggered */
  noiseGateTriggered: boolean;
  /** Current noise gate gain */
  noiseGateGain: number;
  /** Whether echo cancellation is active */
  echoCancellationActive: boolean;
  /** NLMS filter converged */
  nlmsConverged: boolean;
  /** Echo reduction in dB */
  echoReductionDb: number;
}

// ============================================================================
// Embedding Worker Types
// ============================================================================

/**
 * Embedding worker operation types
 */
export type EmbeddingWorkerOperation =
  | 'embed-text' // Generate embedding for single text
  | 'embed-batch' // Generate embeddings for multiple texts
  | 'calculate-similarity' // Calculate cosine similarity between vectors
  | 'tokenize' // Tokenize text
  | 'normalize-vector' // Normalize a vector
  | 'clear-cache'; // Clear embedding cache

/**
 * Embedding worker request message
 */
export interface EmbeddingWorkerRequest extends WorkerMessage {
  type: EmbeddingWorkerOperation;
  payload: EmbeddingWorkerPayload;
}

/**
 * Embedding worker payload types
 */
export interface EmbeddingWorkerPayload {
  /** Text to embed */
  text?: string;
  /** Multiple texts for batch embedding */
  texts?: string[];
  /** Vector A for similarity calculation */
  vectorA?: number[];
  /** Vector B for similarity calculation */
  vectorB?: number[];
  /** Configuration */
  config?: EmbeddingConfig;
}

/**
 * Embedding generation configuration
 */
export interface EmbeddingConfig {
  /** Target embedding dimensions */
  dimensions: number;
  /** Enable caching */
  enableCache: boolean;
  /** Maximum cache size */
  maxCacheSize: number;
  /** Use position encoding */
  usePositionEncoding: boolean;
  /** Normalize output vectors */
  normalizeOutput: boolean;
}

/**
 * Default embedding configuration
 */
export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  dimensions: 384,
  enableCache: true,
  maxCacheSize: 5000,
  usePositionEncoding: true,
  normalizeOutput: true,
};

/**
 * Embedding worker result types
 */
export interface EmbeddingWorkerResult {
  /** Single embedding vector */
  vector?: number[];
  /** Multiple embedding vectors */
  vectors?: number[][];
  /** Cosine similarity score */
  similarity?: number;
  /** Tokens from tokenization */
  tokens?: string[];
  /** Token count */
  tokenCount?: number;
  /** Whether result was from cache */
  cached?: boolean;
}

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}
