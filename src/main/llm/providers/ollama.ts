/**
 * Ollama LLM Provider
 * 
 * Local LLM integration using Ollama for completely offline
 * AI processing. Supports streaming, model management, and
 * automatic fallback.
 * 
 * @module llm/providers/ollama
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('OllamaProvider');

// ============================================================================
// Types
// ============================================================================

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  contextLength: number;
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
  timeout: number;
  keepAlive: string;
}

export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modifiedAt: Date;
  details: {
    format: string;
    family: string;
    families: string[];
    parameterSize: string;
    quantizationLevel: string;
  };
}

export interface OllamaGenerateOptions {
  model?: string;
  prompt: string;
  system?: string;
  template?: string;
  context?: number[];
  stream?: boolean;
  raw?: boolean;
  format?: 'json';
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    repeat_penalty?: number;
    num_ctx?: number;
    num_predict?: number;
    stop?: string[];
  };
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
}

export interface OllamaChatOptions {
  model?: string;
  messages: OllamaChatMessage[];
  stream?: boolean;
  format?: 'json';
  options?: OllamaGenerateOptions['options'];
}

export interface OllamaResponse {
  model: string;
  created_at: string;
  response?: string;
  message?: OllamaChatMessage;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export type OllamaStatus = 'disconnected' | 'connecting' | 'ready' | 'generating' | 'error';

const DEFAULT_CONFIG: OllamaConfig = {
  baseUrl: 'http://localhost:11434',
  model: 'llama3.1:8b',
  contextLength: 8192,
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  repeatPenalty: 1.1,
  timeout: 120000,
  keepAlive: '5m',
};

// Recommended models for different use cases
export const RECOMMENDED_MODELS = {
  general: 'llama3.1:8b',
  coding: 'codellama:7b',
  fast: 'phi3:mini',
  large: 'llama3.1:70b',
  vision: 'llava:7b',
};

// ============================================================================
// Ollama Provider Class
// ============================================================================

export class OllamaProvider extends EventEmitter {
  private config: OllamaConfig;
  private status: OllamaStatus = 'disconnected';
  private currentContext: number[] = [];
  private abortController: AbortController | null = null;

  constructor(config?: Partial<OllamaConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize and verify connection to Ollama
   */
  async initialize(): Promise<boolean> {
    this.setStatus('connecting');
    
    try {
      // Check if Ollama is running
      const response = await this.fetch('/api/tags', {
        method: 'GET',
        timeout: 5000,
      });
      
      if (!response.ok) {
        throw new Error(`Ollama not responding: ${response.status}`);
      }
      
      // Check if the configured model is available
      const models = await this.listModels();
      const hasModel = models.some(m => m.name.startsWith(this.config.model.split(':')[0]));
      
      if (!hasModel) {
        logger.warn(`Model ${this.config.model} not found, attempting to pull...`);
        await this.pullModel(this.config.model);
      }
      
      this.setStatus('ready');
      logger.info('Ollama provider initialized', { model: this.config.model });
      return true;
    } catch (error) {
      this.setStatus('error');
      logger.error('Failed to initialize Ollama:', error);
      return false;
    }
  }

  /**
   * Generate text completion
   */
  async generate(
    prompt: string,
    options?: Partial<OllamaGenerateOptions>
  ): Promise<string> {
    this.setStatus('generating');
    
    const requestBody: OllamaGenerateOptions = {
      model: this.config.model,
      prompt,
      stream: false,
      context: this.currentContext,
      options: {
        temperature: this.config.temperature,
        top_p: this.config.topP,
        top_k: this.config.topK,
        repeat_penalty: this.config.repeatPenalty,
        num_ctx: this.config.contextLength,
      },
      ...options,
    };
    
    try {
      const response = await this.fetch('/api/generate', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });
      
      if (!response.ok) {
        throw new Error(`Generation failed: ${response.status}`);
      }
      
      const data = await response.json() as OllamaResponse;
      
      // Store context for follow-up
      if (data.context) {
        this.currentContext = data.context;
      }
      
      this.setStatus('ready');
      this.emitMetrics(data);
      
      return data.response || '';
    } catch (error) {
      this.setStatus('error');
      throw error;
    }
  }

  /**
   * Generate with streaming
   */
  async *generateStream(
    prompt: string,
    options?: Partial<OllamaGenerateOptions>
  ): AsyncGenerator<string, void, unknown> {
    this.setStatus('generating');
    this.abortController = new AbortController();
    
    const requestBody: OllamaGenerateOptions = {
      model: this.config.model,
      prompt,
      stream: true,
      context: this.currentContext,
      options: {
        temperature: this.config.temperature,
        top_p: this.config.topP,
        top_k: this.config.topK,
        repeat_penalty: this.config.repeatPenalty,
        num_ctx: this.config.contextLength,
      },
      ...options,
    };
    
    try {
      const response = await this.fetch('/api/generate', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal,
      });
      
      if (!response.ok || !response.body) {
        throw new Error(`Streaming failed: ${response.status}`);
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let finalResponse: OllamaResponse | null = null;
      
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.trim());
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line) as OllamaResponse;
            
            if (data.response) {
              yield data.response;
            }
            
            if (data.done) {
              finalResponse = data;
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      }
      
      if (finalResponse?.context) {
        this.currentContext = finalResponse.context;
      }
      
      this.setStatus('ready');
      if (finalResponse) {
        this.emitMetrics(finalResponse);
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        logger.info('Generation aborted');
      } else {
        this.setStatus('error');
        throw error;
      }
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Chat completion
   */
  async chat(
    messages: OllamaChatMessage[],
    options?: Partial<OllamaChatOptions>
  ): Promise<OllamaChatMessage> {
    this.setStatus('generating');
    
    const requestBody: OllamaChatOptions = {
      model: this.config.model,
      messages,
      stream: false,
      options: {
        temperature: this.config.temperature,
        top_p: this.config.topP,
        top_k: this.config.topK,
        repeat_penalty: this.config.repeatPenalty,
        num_ctx: this.config.contextLength,
      },
      ...options,
    };
    
    try {
      const response = await this.fetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });
      
      if (!response.ok) {
        throw new Error(`Chat failed: ${response.status}`);
      }
      
      const data = await response.json() as OllamaResponse;
      
      this.setStatus('ready');
      this.emitMetrics(data);
      
      return data.message || { role: 'assistant', content: '' };
    } catch (error) {
      this.setStatus('error');
      throw error;
    }
  }

  /**
   * Chat with streaming
   */
  async *chatStream(
    messages: OllamaChatMessage[],
    options?: Partial<OllamaChatOptions>
  ): AsyncGenerator<string, void, unknown> {
    this.setStatus('generating');
    this.abortController = new AbortController();
    
    const requestBody: OllamaChatOptions = {
      model: this.config.model,
      messages,
      stream: true,
      options: {
        temperature: this.config.temperature,
        top_p: this.config.topP,
        top_k: this.config.topK,
        repeat_penalty: this.config.repeatPenalty,
        num_ctx: this.config.contextLength,
      },
      ...options,
    };
    
    try {
      const response = await this.fetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal,
      });
      
      if (!response.ok || !response.body) {
        throw new Error(`Chat streaming failed: ${response.status}`);
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let finalResponse: OllamaResponse | null = null;
      
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.trim());
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line) as OllamaResponse;
            
            if (data.message?.content) {
              yield data.message.content;
            }
            
            if (data.done) {
              finalResponse = data;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
      
      this.setStatus('ready');
      if (finalResponse) {
        this.emitMetrics(finalResponse);
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        logger.info('Chat aborted');
      } else {
        this.setStatus('error');
        throw error;
      }
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Stop current generation
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<OllamaModel[]> {
    try {
      const response = await this.fetch('/api/tags', { method: 'GET' });
      
      if (!response.ok) {
        throw new Error(`Failed to list models: ${response.status}`);
      }
      
      const data = await response.json() as { models: OllamaModel[] };
      return data.models || [];
    } catch (error) {
      logger.error('Failed to list models:', error);
      return [];
    }
  }

  /**
   * Pull a model from Ollama library
   */
  async pullModel(
    modelName: string,
    onProgress?: (progress: number) => void
  ): Promise<boolean> {
    logger.info(`Pulling model: ${modelName}`);
    
    try {
      const response = await this.fetch('/api/pull', {
        method: 'POST',
        body: JSON.stringify({ name: modelName, stream: true }),
      });
      
      if (!response.ok || !response.body) {
        throw new Error(`Failed to pull model: ${response.status}`);
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.trim());
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            
            if (data.total && data.completed && onProgress) {
              onProgress((data.completed / data.total) * 100);
            }
            
            if (data.status === 'success') {
              logger.info(`Model ${modelName} pulled successfully`);
              return true;
            }
          } catch {
            // Skip
          }
        }
      }
      
      return true;
    } catch (error) {
      logger.error(`Failed to pull model ${modelName}:`, error);
      return false;
    }
  }

  /**
   * Delete a model
   */
  async deleteModel(modelName: string): Promise<boolean> {
    try {
      const response = await this.fetch('/api/delete', {
        method: 'DELETE',
        body: JSON.stringify({ name: modelName }),
      });
      
      return response.ok;
    } catch (error) {
      logger.error(`Failed to delete model ${modelName}:`, error);
      return false;
    }
  }

  /**
   * Get model information
   */
  async getModelInfo(modelName: string): Promise<OllamaModel | null> {
    try {
      const response = await this.fetch('/api/show', {
        method: 'POST',
        body: JSON.stringify({ name: modelName }),
      });
      
      if (!response.ok) {
        return null;
      }
      
      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * Check if Ollama is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.fetch('/api/tags', {
        method: 'GET',
        timeout: 3000,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get current status
   */
  getStatus(): OllamaStatus {
    return this.status;
  }

  /**
   * Get configuration
   */
  getConfig(): OllamaConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<OllamaConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Ollama config updated', { model: this.config.model });
  }

  /**
   * Clear conversation context
   */
  clearContext(): void {
    this.currentContext = [];
    logger.debug('Context cleared');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Make a fetch request to Ollama API
   */
  private async fetch(
    endpoint: string,
    options: RequestInit & { timeout?: number }
  ): Promise<Response> {
    const url = `${this.config.baseUrl}${endpoint}`;
    const timeout = options.timeout || this.config.timeout;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        signal: options.signal || controller.signal,
      });
      
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Set status and emit event
   */
  private setStatus(status: OllamaStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.emit('status', status);
    }
  }

  /**
   * Emit generation metrics
   */
  private emitMetrics(response: OllamaResponse): void {
    if (response.eval_count && response.eval_duration) {
      const tokensPerSecond = (response.eval_count / response.eval_duration) * 1e9;
      
      this.emit('metrics', {
        model: response.model,
        promptTokens: response.prompt_eval_count,
        generatedTokens: response.eval_count,
        tokensPerSecond: Math.round(tokensPerSecond * 10) / 10,
        totalDuration: response.total_duration ? response.total_duration / 1e6 : undefined,
        loadDuration: response.load_duration ? response.load_duration / 1e6 : undefined,
      });
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let ollamaInstance: OllamaProvider | null = null;

export function getOllamaProvider(config?: Partial<OllamaConfig>): OllamaProvider {
  if (!ollamaInstance) {
    ollamaInstance = new OllamaProvider(config);
  }
  return ollamaInstance;
}

export function resetOllamaProvider(): void {
  if (ollamaInstance) {
    ollamaInstance.abort();
  }
  ollamaInstance = null;
}

export default OllamaProvider;
