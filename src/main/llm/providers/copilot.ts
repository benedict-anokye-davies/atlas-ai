/**
 * GitHub Models LLM Provider
 * Uses your GitHub account to access GPT-4o, Llama, Mistral, and other models for FREE
 * Requires GitHub CLI (gh) to be installed and authenticated
 * 
 * Available models (as of Jan 2026):
 * - gpt-4o (OpenAI)
 * - gpt-4o-mini (OpenAI)
 * - Meta-Llama-3.1-405B-Instruct
 * - Meta-Llama-3.1-70B-Instruct
 * - Meta-Llama-3.1-8B-Instruct
 * - Mistral-large-2407
 * - Mistral-Nemo
 * - AI21-Jamba-Instruct
 */

import { spawn } from 'child_process';
import { createModuleLogger } from '../../utils/logger';
import type { LLMProvider, LLMRequest, LLMResponse, LLMStreamChunk } from '../types';

const logger = createModuleLogger('GitHubModelsProvider');

// GitHub Models API endpoint (different from Copilot Chat API)
const GITHUB_MODELS_API_URL = 'https://models.inference.ai.azure.com/chat/completions';

// Available models through GitHub Models (free with GitHub account)
export type GitHubModel = 
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'Meta-Llama-3.1-405B-Instruct'
  | 'Meta-Llama-3.1-70B-Instruct'
  | 'Meta-Llama-3.1-8B-Instruct'
  | 'Meta-Llama-3-70B-Instruct'
  | 'Meta-Llama-3-8B-Instruct'
  | 'Mistral-large-2407'
  | 'Mistral-Nemo'
  | 'AI21-Jamba-Instruct';

// Backwards compatibility
export type CopilotModel = GitHubModel;

interface CopilotConfig {
  model?: GitHubModel;
  timeout?: number;
}

interface CopilotMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface CopilotStreamDelta {
  choices?: Array<{
    delta?: {
      content?: string;
      role?: string;
    };
    finish_reason?: string | null;
  }>;
}

/**
 * Get GitHub token from GitHub CLI
 */
async function getGitHubToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('gh', ['auth', 'token'], {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Failed to get GitHub token: ${stderr || 'gh auth token failed'}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`GitHub CLI not found. Install it from https://cli.github.com and run 'gh auth login'. Error: ${err.message}`));
    });
  });
}

/**
 * Check if GitHub CLI is installed and authenticated
 */
export async function checkCopilotAvailability(): Promise<{
  available: boolean;
  error?: string;
  username?: string;
}> {
  try {
    // Check if gh is installed
    const token = await getGitHubToken();
    if (!token) {
      return { available: false, error: 'No GitHub token found. Run "gh auth login" first.' };
    }

    // Verify token works by getting user info
    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
      },
    });

    if (!response.ok) {
      return { available: false, error: 'GitHub token is invalid or expired. Run "gh auth login" again.' };
    }

    const user = await response.json() as { login: string };
    logger.info('Copilot provider available', { username: user.login });

    return { available: true, username: user.login };
  } catch (error) {
    return { available: false, error: (error as Error).message };
  }
}

/**
 * GitHub Models LLM Provider (uses GitHub Models API, not Copilot Chat API)
 */
export class CopilotProvider implements LLMProvider {
  name = 'github-models';
  private config: CopilotConfig;
  private token: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: CopilotConfig = {}) {
    this.config = {
      model: config.model || 'gpt-4o',
      timeout: config.timeout || 60000,
    };
  }

  /**
   * Get or refresh the GitHub token
   */
  private async getToken(): Promise<string> {
    // Refresh token if expired or not set (tokens last ~8 hours)
    const now = Date.now();
    if (!this.token || now > this.tokenExpiry) {
      this.token = await getGitHubToken();
      this.tokenExpiry = now + 7 * 60 * 60 * 1000; // Refresh after 7 hours
      logger.debug('GitHub token refreshed');
    }
    return this.token;
  }

  /**
   * Generate a response (non-streaming)
   */
  async generate(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();
    const token = await this.getToken();

    const messages: CopilotMessage[] = [];
    
    // Add system message if provided
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }

    // Add conversation history
    if (request.messages) {
      for (const msg of request.messages) {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }
    }

    // Add current prompt
    if (request.prompt) {
      messages.push({ role: 'user', content: request.prompt });
    }

    const model = request.model || this.config.model || 'gpt-4o';

    logger.debug('GitHub Models request', { model, messageCount: messages.length });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(GITHUB_MODELS_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: request.maxTokens || 4096,
          temperature: request.temperature ?? 0.7,
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('GitHub Models API error', { status: response.status, error: errorText });
        
        if (response.status === 401) {
          this.token = null; // Force token refresh
          throw new Error('GitHub authentication failed. Run "gh auth login" to refresh.');
        }
        if (response.status === 403) {
          throw new Error('GitHub Models access denied. Ensure your GitHub account has access.');
        }
        if (response.status === 429) {
          throw new Error('GitHub Models rate limit exceeded. Please wait before trying again.');
        }
        throw new Error(`GitHub Models API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };

      const content = data.choices?.[0]?.message?.content || '';
      const latency = Date.now() - startTime;

      logger.debug('GitHub Models response', { 
        model, 
        latency,
        tokens: data.usage?.total_tokens,
      });

      return {
        content,
        model,
        provider: 'github-models',
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        } : undefined,
        latency,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === 'AbortError') {
        throw new Error(`GitHub Models request timed out after ${this.config.timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Generate a streaming response
   */
  async *generateStream(request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    const startTime = Date.now();
    const token = await this.getToken();

    const messages: CopilotMessage[] = [];
    
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }

    if (request.messages) {
      for (const msg of request.messages) {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }
    }

    if (request.prompt) {
      messages.push({ role: 'user', content: request.prompt });
    }

    const model = request.model || this.config.model || 'gpt-4o';

    logger.debug('GitHub Models stream request', { model, messageCount: messages.length });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(GITHUB_MODELS_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: request.maxTokens || 4096,
          temperature: request.temperature ?? 0.7,
          stream: true,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('GitHub Models stream API error', { status: response.status, error: errorText });
        
        if (response.status === 401) {
          this.token = null;
          throw new Error('GitHub authentication failed. Run "gh auth login" to refresh.');
        }
        throw new Error(`GitHub Models API error: ${response.status} - ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let isFirstChunk = true;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              yield {
                content: '',
                done: true,
                model,
                provider: 'copilot',
              };
              return;
            }

            try {
              const parsed = JSON.parse(data) as CopilotStreamDelta;
              const content = parsed.choices?.[0]?.delta?.content || '';
              
              if (content) {
                fullContent += content;
                yield {
                  content,
                  done: false,
                  model,
                  provider: 'github-models',
                  isFirst: isFirstChunk,
                };
                isFirstChunk = false;
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }

      const latency = Date.now() - startTime;
      logger.debug('GitHub Models stream complete', { model, latency, contentLength: fullContent.length });

    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === 'AbortError') {
        throw new Error(`GitHub Models stream timed out after ${this.config.timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    // Models available through GitHub Models API (free with GitHub account)
    return [
      'gpt-4o',
      'gpt-4o-mini',
      'Meta-Llama-3.1-405B-Instruct',
      'Meta-Llama-3.1-70B-Instruct',
      'Meta-Llama-3.1-8B-Instruct',
      'Mistral-large-2407',
      'Mistral-Nemo',
    ];
  }

  /**
   * Check if provider is available
   */
  async isAvailable(): Promise<boolean> {
    const result = await checkCopilotAvailability();
    return result.available;
  }

  /**
   * Get provider info
   */
  getInfo(): { name: string; description: string; models: string[] } {
    return {
      name: 'GitHub Models',
      description: 'Access GPT-4o, Llama 3.1, Mistral, and other models FREE with your GitHub account',
      models: [
        'gpt-4o',
        'gpt-4o-mini', 
        'Meta-Llama-3.1-405B-Instruct',
        'Meta-Llama-3.1-70B-Instruct',
        'Meta-Llama-3.1-8B-Instruct',
        'Mistral-large-2407',
        'Mistral-Nemo',
      ],
    };
  }
}

// Singleton instance
let copilotProvider: CopilotProvider | null = null;

export function getCopilotProvider(config?: CopilotConfig): CopilotProvider {
  if (!copilotProvider) {
    copilotProvider = new CopilotProvider(config);
  }
  return copilotProvider;
}

// Alias for clarity
export const getGitHubModelsProvider = getCopilotProvider;
export { CopilotProvider as GitHubModelsProvider };

export default CopilotProvider;
