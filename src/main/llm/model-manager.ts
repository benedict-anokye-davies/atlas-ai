/**
 * Local Model Manager
 * 
 * Manages local LLM models including downloading, storage,
 * selection, and configuration. Supports Ollama and other
 * local inference providers.
 * 
 * @module llm/model-manager
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getOllamaProvider, OllamaModel, RECOMMENDED_MODELS } from './providers/ollama';

const logger = createModuleLogger('ModelManager');

// ============================================================================
// Types
// ============================================================================

export interface ModelInfo {
  id: string;
  name: string;
  provider: 'ollama' | 'llamacpp' | 'transformers';
  size: number;
  sizeHuman: string;
  quantization?: string;
  family?: string;
  parameterCount?: string;
  contextLength: number;
  capabilities: ModelCapability[];
  isInstalled: boolean;
  isDefault: boolean;
  downloadProgress?: number;
  performance?: ModelPerformance;
}

export type ModelCapability = 'chat' | 'completion' | 'embedding' | 'vision' | 'code' | 'function-calling';

export interface ModelPerformance {
  tokensPerSecond: number;
  memoryUsage: number;
  loadTime: number;
  lastUsed?: Date;
}

export interface DownloadProgress {
  modelId: string;
  progress: number;
  downloaded: number;
  total: number;
  speed: number;
  eta: number;
}

export interface ModelManagerConfig {
  modelsDir: string;
  defaultModel: string;
  autoUpdate: boolean;
  maxConcurrentDownloads: number;
  diskSpaceThreshold: number;  // MB
}

const DEFAULT_CONFIG: ModelManagerConfig = {
  modelsDir: path.join(app.getPath('userData'), 'models'),
  defaultModel: 'llama3.1:8b',
  autoUpdate: false,
  maxConcurrentDownloads: 1,
  diskSpaceThreshold: 5000,  // 5GB minimum
};

// Model catalog with metadata
const MODEL_CATALOG: Omit<ModelInfo, 'isInstalled' | 'isDefault'>[] = [
  {
    id: 'llama3.1:8b',
    name: 'Llama 3.1 8B',
    provider: 'ollama',
    size: 4700000000,
    sizeHuman: '4.7 GB',
    quantization: 'Q4_K_M',
    family: 'llama',
    parameterCount: '8B',
    contextLength: 8192,
    capabilities: ['chat', 'completion', 'code'],
  },
  {
    id: 'llama3.1:70b',
    name: 'Llama 3.1 70B',
    provider: 'ollama',
    size: 40000000000,
    sizeHuman: '40 GB',
    quantization: 'Q4_K_M',
    family: 'llama',
    parameterCount: '70B',
    contextLength: 8192,
    capabilities: ['chat', 'completion', 'code', 'function-calling'],
  },
  {
    id: 'codellama:7b',
    name: 'Code Llama 7B',
    provider: 'ollama',
    size: 3800000000,
    sizeHuman: '3.8 GB',
    quantization: 'Q4_K_M',
    family: 'codellama',
    parameterCount: '7B',
    contextLength: 16384,
    capabilities: ['completion', 'code'],
  },
  {
    id: 'codellama:13b',
    name: 'Code Llama 13B',
    provider: 'ollama',
    size: 7400000000,
    sizeHuman: '7.4 GB',
    quantization: 'Q4_K_M',
    family: 'codellama',
    parameterCount: '13B',
    contextLength: 16384,
    capabilities: ['completion', 'code'],
  },
  {
    id: 'phi3:mini',
    name: 'Phi-3 Mini',
    provider: 'ollama',
    size: 2300000000,
    sizeHuman: '2.3 GB',
    quantization: 'Q4_K_M',
    family: 'phi',
    parameterCount: '3.8B',
    contextLength: 4096,
    capabilities: ['chat', 'completion'],
  },
  {
    id: 'phi3:medium',
    name: 'Phi-3 Medium',
    provider: 'ollama',
    size: 7900000000,
    sizeHuman: '7.9 GB',
    quantization: 'Q4_K_M',
    family: 'phi',
    parameterCount: '14B',
    contextLength: 4096,
    capabilities: ['chat', 'completion'],
  },
  {
    id: 'mistral:7b',
    name: 'Mistral 7B',
    provider: 'ollama',
    size: 4100000000,
    sizeHuman: '4.1 GB',
    quantization: 'Q4_K_M',
    family: 'mistral',
    parameterCount: '7B',
    contextLength: 8192,
    capabilities: ['chat', 'completion', 'code'],
  },
  {
    id: 'mixtral:8x7b',
    name: 'Mixtral 8x7B',
    provider: 'ollama',
    size: 26000000000,
    sizeHuman: '26 GB',
    quantization: 'Q4_K_M',
    family: 'mixtral',
    parameterCount: '46.7B MoE',
    contextLength: 32768,
    capabilities: ['chat', 'completion', 'code', 'function-calling'],
  },
  {
    id: 'llava:7b',
    name: 'LLaVA 7B (Vision)',
    provider: 'ollama',
    size: 4500000000,
    sizeHuman: '4.5 GB',
    quantization: 'Q4_K_M',
    family: 'llava',
    parameterCount: '7B',
    contextLength: 4096,
    capabilities: ['chat', 'vision'],
  },
  {
    id: 'deepseek-coder:6.7b',
    name: 'DeepSeek Coder 6.7B',
    provider: 'ollama',
    size: 3800000000,
    sizeHuman: '3.8 GB',
    quantization: 'Q4_K_M',
    family: 'deepseek',
    parameterCount: '6.7B',
    contextLength: 16384,
    capabilities: ['completion', 'code'],
  },
  {
    id: 'qwen2:7b',
    name: 'Qwen2 7B',
    provider: 'ollama',
    size: 4500000000,
    sizeHuman: '4.5 GB',
    quantization: 'Q4_K_M',
    family: 'qwen',
    parameterCount: '7B',
    contextLength: 32768,
    capabilities: ['chat', 'completion', 'code'],
  },
  {
    id: 'nomic-embed-text',
    name: 'Nomic Embed Text',
    provider: 'ollama',
    size: 274000000,
    sizeHuman: '274 MB',
    family: 'nomic',
    parameterCount: '137M',
    contextLength: 8192,
    capabilities: ['embedding'],
  },
];

// ============================================================================
// Model Manager Class
// ============================================================================

export class ModelManager extends EventEmitter {
  private config: ModelManagerConfig;
  private installedModels: Map<string, ModelInfo> = new Map();
  private downloadQueue: string[] = [];
  private activeDownloads: Map<string, DownloadProgress> = new Map();
  private performanceData: Map<string, ModelPerformance> = new Map();

  constructor(config?: Partial<ModelManagerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ensureDir(this.config.modelsDir);
  }

  /**
   * Initialize model manager
   */
  async initialize(): Promise<void> {
    logger.info('Initializing model manager');
    
    // Load installed models
    await this.refreshInstalledModels();
    
    // Load performance data
    this.loadPerformanceData();
    
    logger.info(`Found ${this.installedModels.size} installed models`);
  }

  /**
   * Get all available models (catalog + installed)
   */
  async getAvailableModels(): Promise<ModelInfo[]> {
    await this.refreshInstalledModels();
    
    const models: ModelInfo[] = [];
    
    // Add catalog models with installation status
    for (const catalogModel of MODEL_CATALOG) {
      const installed = this.installedModels.has(catalogModel.id);
      const performance = this.performanceData.get(catalogModel.id);
      
      models.push({
        ...catalogModel,
        isInstalled: installed,
        isDefault: catalogModel.id === this.config.defaultModel,
        performance,
      });
    }
    
    // Add any installed models not in catalog
    for (const [id, model] of this.installedModels) {
      if (!models.find(m => m.id === id)) {
        models.push(model);
      }
    }
    
    return models;
  }

  /**
   * Get installed models only
   */
  getInstalledModels(): ModelInfo[] {
    return Array.from(this.installedModels.values());
  }

  /**
   * Download and install a model
   */
  async downloadModel(
    modelId: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<boolean> {
    // Check if already downloading
    if (this.activeDownloads.has(modelId)) {
      logger.warn(`Model ${modelId} is already downloading`);
      return false;
    }
    
    // Check disk space
    const modelInfo = MODEL_CATALOG.find(m => m.id === modelId);
    if (modelInfo) {
      const hasSpace = await this.checkDiskSpace(modelInfo.size);
      if (!hasSpace) {
        this.emit('error', { modelId, error: 'Insufficient disk space' });
        return false;
      }
    }
    
    logger.info(`Starting download: ${modelId}`);
    
    const progress: DownloadProgress = {
      modelId,
      progress: 0,
      downloaded: 0,
      total: modelInfo?.size || 0,
      speed: 0,
      eta: 0,
    };
    
    this.activeDownloads.set(modelId, progress);
    this.emit('download:start', progress);
    
    try {
      const ollama = getOllamaProvider();
      
      const success = await ollama.pullModel(modelId, (pct) => {
        progress.progress = pct;
        progress.downloaded = (pct / 100) * progress.total;
        
        if (onProgress) onProgress(progress);
        this.emit('download:progress', progress);
      });
      
      if (success) {
        await this.refreshInstalledModels();
        this.emit('download:complete', { modelId });
        logger.info(`Model ${modelId} downloaded successfully`);
      }
      
      return success;
    } catch (error) {
      logger.error(`Failed to download model ${modelId}:`, error);
      this.emit('download:error', { modelId, error });
      return false;
    } finally {
      this.activeDownloads.delete(modelId);
    }
  }

  /**
   * Delete a model
   */
  async deleteModel(modelId: string): Promise<boolean> {
    logger.info(`Deleting model: ${modelId}`);
    
    try {
      const ollama = getOllamaProvider();
      const success = await ollama.deleteModel(modelId);
      
      if (success) {
        this.installedModels.delete(modelId);
        this.performanceData.delete(modelId);
        this.emit('model:deleted', { modelId });
      }
      
      return success;
    } catch (error) {
      logger.error(`Failed to delete model ${modelId}:`, error);
      return false;
    }
  }

  /**
   * Set the default model
   */
  setDefaultModel(modelId: string): void {
    if (!this.installedModels.has(modelId)) {
      throw new Error(`Model ${modelId} is not installed`);
    }
    
    this.config.defaultModel = modelId;
    this.emit('default:changed', { modelId });
    logger.info(`Default model set to: ${modelId}`);
  }

  /**
   * Get the default model
   */
  getDefaultModel(): string {
    return this.config.defaultModel;
  }

  /**
   * Get recommended model for a use case
   */
  getRecommendedModel(useCase: keyof typeof RECOMMENDED_MODELS): string {
    return RECOMMENDED_MODELS[useCase];
  }

  /**
   * Update performance data for a model
   */
  updatePerformance(modelId: string, performance: Partial<ModelPerformance>): void {
    const existing = this.performanceData.get(modelId) || {
      tokensPerSecond: 0,
      memoryUsage: 0,
      loadTime: 0,
    };
    
    this.performanceData.set(modelId, {
      ...existing,
      ...performance,
      lastUsed: new Date(),
    });
    
    this.savePerformanceData();
  }

  /**
   * Get download progress
   */
  getDownloadProgress(modelId: string): DownloadProgress | null {
    return this.activeDownloads.get(modelId) || null;
  }

  /**
   * Cancel a download
   */
  cancelDownload(modelId: string): void {
    const ollama = getOllamaProvider();
    ollama.abort();
    this.activeDownloads.delete(modelId);
    this.emit('download:cancelled', { modelId });
  }

  /**
   * Check if Ollama is available
   */
  async isOllamaAvailable(): Promise<boolean> {
    const ollama = getOllamaProvider();
    return await ollama.isAvailable();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Refresh list of installed models from Ollama
   */
  private async refreshInstalledModels(): Promise<void> {
    try {
      const ollama = getOllamaProvider();
      const models = await ollama.listModels();
      
      this.installedModels.clear();
      
      for (const model of models) {
        const catalogInfo = MODEL_CATALOG.find(m => 
          model.name.startsWith(m.id.split(':')[0])
        );
        
        const modelInfo: ModelInfo = {
          id: model.name,
          name: catalogInfo?.name || model.name,
          provider: 'ollama',
          size: model.size,
          sizeHuman: this.formatSize(model.size),
          quantization: model.details?.quantizationLevel,
          family: model.details?.family,
          parameterCount: model.details?.parameterSize,
          contextLength: catalogInfo?.contextLength || 4096,
          capabilities: catalogInfo?.capabilities || ['chat', 'completion'],
          isInstalled: true,
          isDefault: model.name === this.config.defaultModel,
          performance: this.performanceData.get(model.name),
        };
        
        this.installedModels.set(model.name, modelInfo);
      }
    } catch (error) {
      logger.error('Failed to refresh installed models:', error);
    }
  }

  /**
   * Check if there's enough disk space
   */
  private async checkDiskSpace(requiredBytes: number): Promise<boolean> {
    // Simple check - in production would use os.freemem() or df
    const requiredMB = requiredBytes / (1024 * 1024);
    const thresholdMB = this.config.diskSpaceThreshold;
    
    // Assume we need at least the model size + threshold
    return requiredMB + thresholdMB < 100000; // Placeholder
  }

  /**
   * Load performance data from disk
   */
  private loadPerformanceData(): void {
    const filePath = path.join(this.config.modelsDir, 'performance.json');
    
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        this.performanceData = new Map(Object.entries(data));
      }
    } catch (error) {
      logger.warn('Failed to load performance data:', error);
    }
  }

  /**
   * Save performance data to disk
   */
  private savePerformanceData(): void {
    const filePath = path.join(this.config.modelsDir, 'performance.json');
    
    try {
      const data = Object.fromEntries(this.performanceData);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.warn('Failed to save performance data:', error);
    }
  }

  /**
   * Format bytes to human-readable string
   */
  private formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unitIndex = 0;
    let size = bytes;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  /**
   * Ensure directory exists
   */
  private ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let managerInstance: ModelManager | null = null;

export function getModelManager(config?: Partial<ModelManagerConfig>): ModelManager {
  if (!managerInstance) {
    managerInstance = new ModelManager(config);
  }
  return managerInstance;
}

export function resetModelManager(): void {
  managerInstance = null;
}

export default ModelManager;
