/**
 * Atlas Desktop - Model Optimizer
 * Optimize model loading, caching, and quantization
 *
 * Features:
 * - Model caching and preloading
 * - Dynamic quantization
 * - Memory-efficient loading
 * - Model version management
 * - Inference optimization
 *
 * @module ml/model-optimizer
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { createModuleLogger } from '../utils/logger';
import { getErrorMessage } from '../../shared/utils';

const logger = createModuleLogger('ModelOptimizer');

// ============================================================================
// Types
// ============================================================================

export interface ModelConfig {
  id: string;
  name: string;
  type: ModelType;
  provider: string;
  version: string;
  size: number; // bytes
  quantization?: QuantizationType;
  priority: 'high' | 'medium' | 'low';
  preload: boolean;
  cacheTTL: number; // ms, 0 = forever
  maxMemory?: number; // max memory usage in bytes
  metadata: Record<string, unknown>;
}

export type ModelType = 'llm' | 'stt' | 'tts' | 'embedding' | 'classifier' | 'vision' | 'audio' | 'other';

export type QuantizationType = 'none' | 'int8' | 'int4' | 'fp16' | 'dynamic';

export interface ModelState {
  id: string;
  status: 'unloaded' | 'loading' | 'loaded' | 'error' | 'cached';
  loadTime?: number;
  lastUsed?: number;
  useCount: number;
  memoryUsage?: number;
  errorMessage?: string;
  inferenceStats: InferenceStats;
}

export interface InferenceStats {
  totalInferences: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  errorsCount: number;
  tokensProcessed?: number;
}

export interface ModelLoadOptions {
  priority?: boolean;
  quantization?: QuantizationType;
  maxMemory?: number;
  warmUp?: boolean;
}

export interface OptimizationSuggestion {
  modelId: string;
  type: 'quantize' | 'preload' | 'evict' | 'upgrade';
  reason: string;
  impact: {
    memory?: number;
    latency?: number;
    quality?: number;
  };
}

export interface ModelOptimizerConfig {
  cacheDir: string;
  maxCacheSize: number; // bytes
  maxLoadedModels: number;
  autoEvict: boolean;
  preferQuantization: boolean;
  warmUpOnLoad: boolean;
  memoryThreshold: number; // percentage
}

// ============================================================================
// Model Cache Manager
// ============================================================================

class ModelCacheManager {
  private cacheDir: string;
  private maxSize: number;
  private currentSize: number = 0;
  private cacheIndex: Map<string, { path: string; size: number; lastAccess: number }> = new Map();

  constructor(cacheDir: string, maxSize: number) {
    this.cacheDir = cacheDir;
    this.maxSize = maxSize;
    this.loadIndex();
  }

  private loadIndex(): void {
    const indexPath = path.join(this.cacheDir, 'cache-index.json');
    try {
      if (fs.existsSync(indexPath)) {
        const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        for (const [id, entry] of Object.entries(data.entries || {})) {
          this.cacheIndex.set(id, entry as { path: string; size: number; lastAccess: number });
          this.currentSize += (entry as { size: number }).size;
        }
      }
    } catch (error) {
      logger.warn('Failed to load cache index', { error });
    }
  }

  private saveIndex(): void {
    const indexPath = path.join(this.cacheDir, 'cache-index.json');
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      const data = {
        entries: Object.fromEntries(this.cacheIndex),
        totalSize: this.currentSize,
        savedAt: Date.now(),
      };
      fs.writeFileSync(indexPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.warn('Failed to save cache index', { error });
    }
  }

  /**
   * Check if model is cached
   */
  isCached(modelId: string): boolean {
    const entry = this.cacheIndex.get(modelId);
    if (!entry) return false;
    return fs.existsSync(entry.path);
  }

  /**
   * Get cached model path
   */
  getCachePath(modelId: string): string | null {
    const entry = this.cacheIndex.get(modelId);
    if (!entry || !fs.existsSync(entry.path)) return null;

    entry.lastAccess = Date.now();
    this.saveIndex();
    return entry.path;
  }

  /**
   * Add model to cache
   */
  async addToCache(modelId: string, data: Buffer): Promise<string> {
    // Evict if needed
    while (this.currentSize + data.length > this.maxSize) {
      this.evictLRU();
    }

    const modelPath = path.join(this.cacheDir, `${modelId}.bin`);
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.writeFileSync(modelPath, data);

    this.cacheIndex.set(modelId, {
      path: modelPath,
      size: data.length,
      lastAccess: Date.now(),
    });
    this.currentSize += data.length;

    this.saveIndex();
    return modelPath;
  }

  /**
   * Evict least recently used
   */
  private evictLRU(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const [id, entry] of this.cacheIndex) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestId = id;
      }
    }

    if (oldestId) {
      this.evict(oldestId);
    }
  }

  /**
   * Evict specific model
   */
  evict(modelId: string): boolean {
    const entry = this.cacheIndex.get(modelId);
    if (!entry) return false;

    try {
      if (fs.existsSync(entry.path)) {
        fs.unlinkSync(entry.path);
      }
      this.currentSize -= entry.size;
      this.cacheIndex.delete(modelId);
      this.saveIndex();
      return true;
    } catch (error) {
      logger.warn('Failed to evict model', { modelId, error });
      return false;
    }
  }

  /**
   * Get cache stats
   */
  getStats(): { totalSize: number; maxSize: number; modelCount: number; utilization: number } {
    return {
      totalSize: this.currentSize,
      maxSize: this.maxSize,
      modelCount: this.cacheIndex.size,
      utilization: this.currentSize / this.maxSize,
    };
  }

  /**
   * Clear all cache
   */
  clear(): void {
    for (const [id] of this.cacheIndex) {
      this.evict(id);
    }
  }
}

// ============================================================================
// Quantization Manager
// ============================================================================

class QuantizationManager {
  /**
   * Get optimal quantization for memory constraints
   */
  recommendQuantization(
    modelSize: number,
    availableMemory: number,
    qualityRequirement: 'high' | 'medium' | 'low'
  ): QuantizationType {
    const memoryRatio = modelSize / availableMemory;

    // High quality requirement
    if (qualityRequirement === 'high') {
      if (memoryRatio < 0.3) return 'none';
      if (memoryRatio < 0.5) return 'fp16';
      return 'int8';
    }

    // Medium quality
    if (qualityRequirement === 'medium') {
      if (memoryRatio < 0.3) return 'fp16';
      if (memoryRatio < 0.5) return 'int8';
      return 'int4';
    }

    // Low quality / efficiency mode
    if (memoryRatio < 0.5) return 'int8';
    return 'int4';
  }

  /**
   * Estimate memory reduction from quantization
   */
  estimateMemoryReduction(originalSize: number, quantization: QuantizationType): number {
    const reductionFactors: Record<QuantizationType, number> = {
      none: 1,
      fp16: 0.5,
      int8: 0.25,
      int4: 0.125,
      dynamic: 0.3, // Average estimate
    };

    return originalSize * (1 - reductionFactors[quantization]);
  }

  /**
   * Estimate quality impact
   */
  estimateQualityImpact(quantization: QuantizationType): number {
    // Returns quality retention (1 = no loss, 0 = complete loss)
    const qualityFactors: Record<QuantizationType, number> = {
      none: 1.0,
      fp16: 0.99,
      int8: 0.95,
      int4: 0.85,
      dynamic: 0.92,
    };

    return qualityFactors[quantization];
  }
}

// ============================================================================
// Model Optimizer
// ============================================================================

export class ModelOptimizer extends EventEmitter {
  private config: ModelOptimizerConfig;
  private models: Map<string, ModelConfig> = new Map();
  private modelStates: Map<string, ModelState> = new Map();
  private cacheManager: ModelCacheManager;
  private quantizationManager: QuantizationManager;
  private loadQueue: string[] = [];
  private dataPath: string;

  // Stats
  private stats = {
    modelsLoaded: 0,
    totalInferences: 0,
    cacheHits: 0,
    cacheMisses: 0,
    avgLoadTime: 0,
    memoryOptimized: 0,
  };

  constructor(config?: Partial<ModelOptimizerConfig>) {
    super();
    this.config = {
      cacheDir: path.join(app.getPath('userData'), 'model-cache'),
      maxCacheSize: 2 * 1024 * 1024 * 1024, // 2GB
      maxLoadedModels: 5,
      autoEvict: true,
      preferQuantization: true,
      warmUpOnLoad: true,
      memoryThreshold: 80,
      ...config,
    };

    this.cacheManager = new ModelCacheManager(this.config.cacheDir, this.config.maxCacheSize);
    this.quantizationManager = new QuantizationManager();
    this.dataPath = path.join(app.getPath('userData'), 'model-optimizer.json');

    this.loadData();
    logger.info('ModelOptimizer initialized', { config: this.config });
  }

  // ============================================================================
  // Data Persistence
  // ============================================================================

  private loadData(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));

        for (const model of data.models || []) {
          this.models.set(model.id, model);
        }

        for (const state of data.modelStates || []) {
          // Reset runtime state
          state.status = 'unloaded';
          this.modelStates.set(state.id, state);
        }

        if (data.stats) {
          this.stats = data.stats;
        }

        logger.info('Loaded model optimizer data', { models: this.models.size });
      }
    } catch (error) {
      logger.warn('Failed to load model optimizer data', { error });
    }
  }

  private saveData(): void {
    try {
      const data = {
        models: Array.from(this.models.values()),
        modelStates: Array.from(this.modelStates.values()),
        stats: this.stats,
        savedAt: Date.now(),
      };
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.warn('Failed to save model optimizer data', { error });
    }
  }

  // ============================================================================
  // Model Registration
  // ============================================================================

  /**
   * Register a model
   */
  registerModel(config: ModelConfig): void {
    this.models.set(config.id, config);

    if (!this.modelStates.has(config.id)) {
      this.modelStates.set(config.id, {
        id: config.id,
        status: 'unloaded',
        useCount: 0,
        inferenceStats: {
          totalInferences: 0,
          avgLatency: 0,
          minLatency: Infinity,
          maxLatency: 0,
          errorsCount: 0,
        },
      });
    }

    // Queue for preload if configured
    if (config.preload) {
      this.loadQueue.push(config.id);
    }

    this.emit('model-registered', config);
    this.saveData();
  }

  /**
   * Unregister a model
   */
  unregisterModel(modelId: string): void {
    this.models.delete(modelId);
    this.modelStates.delete(modelId);
    this.cacheManager.evict(modelId);
    this.saveData();
  }

  // ============================================================================
  // Model Loading
  // ============================================================================

  /**
   * Request model load
   */
  async requestLoad(modelId: string, options: ModelLoadOptions = {}): Promise<boolean> {
    const config = this.models.get(modelId);
    if (!config) {
      logger.warn('Model not registered', { modelId });
      return false;
    }

    const state = this.modelStates.get(modelId);
    if (!state) return false;

    // Check if already loaded
    if (state.status === 'loaded') {
      state.lastUsed = Date.now();
      return true;
    }

    // Check if loading
    if (state.status === 'loading') {
      return this.waitForLoad(modelId);
    }

    // Check memory constraints
    if (this.config.autoEvict) {
      await this.ensureMemory(config.size);
    }

    // Load model
    state.status = 'loading';
    this.emit('model-loading', modelId);

    try {
      const startTime = Date.now();

      // Check cache
      const cachedPath = this.cacheManager.getCachePath(modelId);
      if (cachedPath) {
        this.stats.cacheHits++;
        logger.info('Model loaded from cache', { modelId });
      } else {
        this.stats.cacheMisses++;
        // In real implementation, would download/load model here
      }

      state.status = 'loaded';
      state.loadTime = Date.now() - startTime;
      state.lastUsed = Date.now();
      state.useCount++;

      this.stats.modelsLoaded++;
      this.stats.avgLoadTime =
        (this.stats.avgLoadTime * (this.stats.modelsLoaded - 1) + state.loadTime) / this.stats.modelsLoaded;

      // Warm up if requested
      if (options.warmUp || this.config.warmUpOnLoad) {
        await this.warmUp(modelId);
      }

      this.emit('model-loaded', modelId, state);
      this.saveData();

      return true;
    } catch (error) {
      state.status = 'error';
      state.errorMessage = getErrorMessage(error);
      this.emit('model-error', modelId, error);
      return false;
    }
  }

  /**
   * Unload model
   */
  unloadModel(modelId: string): void {
    const state = this.modelStates.get(modelId);
    if (!state) return;

    state.status = 'unloaded';
    state.memoryUsage = undefined;

    this.emit('model-unloaded', modelId);
    this.saveData();
  }

  /**
   * Wait for model to finish loading
   */
  private waitForLoad(modelId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const checkState = (): void => {
        const state = this.modelStates.get(modelId);
        if (!state || state.status === 'error') {
          resolve(false);
          return;
        }
        if (state.status === 'loaded') {
          resolve(true);
          return;
        }
        setTimeout(checkState, 100);
      };
      checkState();
    });
  }

  /**
   * Warm up model with test inference
   */
  private async warmUp(modelId: string): Promise<void> {
    // In real implementation, would run a test inference
    logger.info('Model warmed up', { modelId });
  }

  /**
   * Ensure memory is available
   */
  private async ensureMemory(requiredBytes: number): Promise<void> {
    const loadedModels = Array.from(this.modelStates.values())
      .filter((s) => s.status === 'loaded')
      .sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));

    let freedMemory = 0;
    for (const state of loadedModels) {
      if (freedMemory >= requiredBytes) break;

      const config = this.models.get(state.id);
      if (!config) continue;

      // Don't evict high priority models
      if (config.priority === 'high') continue;

      this.unloadModel(state.id);
      freedMemory += state.memoryUsage || config.size;
    }
  }

  // ============================================================================
  // Inference Tracking
  // ============================================================================

  /**
   * Record inference
   */
  recordInference(modelId: string, latencyMs: number, tokens?: number, error?: boolean): void {
    const state = this.modelStates.get(modelId);
    if (!state) return;

    const stats = state.inferenceStats;
    stats.totalInferences++;
    stats.avgLatency = (stats.avgLatency * (stats.totalInferences - 1) + latencyMs) / stats.totalInferences;
    stats.minLatency = Math.min(stats.minLatency, latencyMs);
    stats.maxLatency = Math.max(stats.maxLatency, latencyMs);

    if (tokens) {
      stats.tokensProcessed = (stats.tokensProcessed || 0) + tokens;
    }

    if (error) {
      stats.errorsCount++;
    }

    state.lastUsed = Date.now();
    this.stats.totalInferences++;
    this.saveData();
  }

  // ============================================================================
  // Optimization
  // ============================================================================

  /**
   * Get optimization suggestions
   */
  getOptimizationSuggestions(): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    for (const [modelId, config] of this.models) {
      const state = this.modelStates.get(modelId);
      if (!state) continue;

      // Suggest quantization for large models
      if (config.size > 1024 * 1024 * 1024 && !config.quantization) {
        const recommended = this.quantizationManager.recommendQuantization(
          config.size,
          2 * 1024 * 1024 * 1024, // Assume 2GB available
          'medium'
        );

        if (recommended !== 'none') {
          suggestions.push({
            modelId,
            type: 'quantize',
            reason: 'Large model could benefit from quantization',
            impact: {
              memory: this.quantizationManager.estimateMemoryReduction(config.size, recommended),
              latency: -5, // Slight latency increase
              quality: (1 - this.quantizationManager.estimateQualityImpact(recommended)) * 100,
            },
          });
        }
      }

      // Suggest preloading for frequently used models
      if (state.useCount > 10 && !config.preload) {
        suggestions.push({
          modelId,
          type: 'preload',
          reason: 'Frequently used model should be preloaded',
          impact: {
            latency: state.loadTime ? -state.loadTime : -1000,
          },
        });
      }

      // Suggest eviction for rarely used models
      if (state.status === 'loaded') {
        const hoursSinceUse = state.lastUsed ? (Date.now() - state.lastUsed) / (60 * 60 * 1000) : Infinity;

        if (hoursSinceUse > 24 && config.priority !== 'high') {
          suggestions.push({
            modelId,
            type: 'evict',
            reason: `Model unused for ${Math.round(hoursSinceUse)} hours`,
            impact: {
              memory: state.memoryUsage || config.size,
            },
          });
        }
      }
    }

    return suggestions;
  }

  /**
   * Apply optimization suggestion
   */
  applyOptimization(suggestion: OptimizationSuggestion): void {
    switch (suggestion.type) {
      case 'evict':
        this.unloadModel(suggestion.modelId);
        this.stats.memoryOptimized += suggestion.impact.memory || 0;
        break;

      case 'preload':
        const config = this.models.get(suggestion.modelId);
        if (config) {
          config.preload = true;
          this.requestLoad(suggestion.modelId);
        }
        break;

      case 'quantize':
        const modelConfig = this.models.get(suggestion.modelId);
        if (modelConfig) {
          const recommended = this.quantizationManager.recommendQuantization(
            modelConfig.size,
            2 * 1024 * 1024 * 1024,
            'medium'
          );
          modelConfig.quantization = recommended;
        }
        break;
    }

    this.emit('optimization-applied', suggestion);
    this.saveData();
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  /**
   * Get model config
   */
  getModel(modelId: string): ModelConfig | undefined {
    return this.models.get(modelId);
  }

  /**
   * Get model state
   */
  getModelState(modelId: string): ModelState | undefined {
    return this.modelStates.get(modelId);
  }

  /**
   * Get all models
   */
  getAllModels(): { config: ModelConfig; state: ModelState }[] {
    const result: { config: ModelConfig; state: ModelState }[] = [];

    for (const [id, config] of this.models) {
      const state = this.modelStates.get(id);
      if (state) {
        result.push({ config, state });
      }
    }

    return result;
  }

  /**
   * Get loaded models
   */
  getLoadedModels(): ModelConfig[] {
    return Array.from(this.models.values()).filter((config) => {
      const state = this.modelStates.get(config.id);
      return state?.status === 'loaded';
    });
  }

  /**
   * Get cache stats
   */
  getCacheStats(): ReturnType<ModelCacheManager['getStats']> {
    return this.cacheManager.getStats();
  }

  /**
   * Get statistics
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cacheManager.clear();
    logger.info('Model cache cleared');
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ModelOptimizerConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Config updated', { config: this.config });
  }

  /**
   * Process preload queue
   */
  async processPreloadQueue(): Promise<void> {
    for (const modelId of this.loadQueue) {
      await this.requestLoad(modelId, { priority: false });
    }
    this.loadQueue = [];
  }
}

// ============================================================================
// Singleton
// ============================================================================

let modelOptimizer: ModelOptimizer | null = null;

export function getModelOptimizer(): ModelOptimizer {
  if (!modelOptimizer) {
    modelOptimizer = new ModelOptimizer();
  }
  return modelOptimizer;
}
