/**
 * Atlas Desktop - Perplexity Research Tool
 *
 * Uses Perplexity AI for real-time web research with citations.
 * Perplexity provides up-to-date information with source citations.
 *
 * Use cases:
 * - "Research the latest on React 19"
 * - "What's the current price of Bitcoin?"
 * - "Find information about GLM-4.7 model"
 *
 * @module agent/tools/perplexity-research
 */

import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import { getConfig } from '../../config';

const logger = createModuleLogger('PerplexityResearch');

/**
 * Perplexity API response types
 */
interface PerplexityMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface PerplexityCitation {
  url: string;
  title?: string;
}

interface PerplexityChoice {
  index: number;
  message: PerplexityMessage;
  finish_reason: string;
}

interface PerplexityResponse {
  id: string;
  model: string;
  created: number;
  choices: PerplexityChoice[];
  citations?: PerplexityCitation[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Research query options
 */
interface ResearchOptions {
  /** Focus area for research */
  focus?: 'web' | 'academic' | 'news' | 'youtube' | 'reddit';
  /** Return citations with response */
  includeCitations?: boolean;
  /** Maximum tokens for response */
  maxTokens?: number;
  /** Search recency filter */
  recency?: 'day' | 'week' | 'month' | 'year';
}

/**
 * Research result
 */
interface ResearchResult {
  answer: string;
  citations: Array<{
    url: string;
    title?: string;
  }>;
  model: string;
  tokensUsed: number;
}

/**
 * Perplexity models available
 */
const PERPLEXITY_MODELS = {
  // Online models (with web search)
  SONAR_SMALL: 'llama-3.1-sonar-small-128k-online',
  SONAR_LARGE: 'llama-3.1-sonar-large-128k-online',
  SONAR_HUGE: 'llama-3.1-sonar-huge-128k-online',
  // Chat models (no web search, cheaper)
  SONAR_SMALL_CHAT: 'llama-3.1-sonar-small-128k-chat',
  SONAR_LARGE_CHAT: 'llama-3.1-sonar-large-128k-chat',
} as const;

/**
 * Default model for research (with web search)
 */
const DEFAULT_MODEL = PERPLEXITY_MODELS.SONAR_LARGE;

/**
 * Execute a research query using Perplexity AI
 */
async function executeResearch(
  query: string,
  options: ResearchOptions = {}
): Promise<ResearchResult> {
  const config = getConfig();
  const apiKey = config.perplexityApiKey;

  if (!apiKey) {
    throw new Error(
      'Perplexity API key not configured. Set PERPLEXITY_API_KEY in your environment.'
    );
  }

  const {
    focus = 'web',
    includeCitations = true,
    maxTokens = 2048,
    recency,
  } = options;

  // Build system prompt based on focus
  const systemPrompts: Record<string, string> = {
    web: 'You are a helpful research assistant. Provide accurate, up-to-date information with citations.',
    academic: 'You are an academic research assistant. Focus on peer-reviewed sources and scholarly content.',
    news: 'You are a news research assistant. Focus on recent news articles and current events.',
    youtube: 'You are a video research assistant. Focus on YouTube content and video summaries.',
    reddit: 'You are a community research assistant. Focus on Reddit discussions and community insights.',
  };

  const messages: PerplexityMessage[] = [
    {
      role: 'system',
      content: systemPrompts[focus] || systemPrompts.web,
    },
    {
      role: 'user',
      content: query,
    },
  ];

  const requestBody: Record<string, unknown> = {
    model: DEFAULT_MODEL,
    messages,
    max_tokens: maxTokens,
    return_citations: includeCitations,
  };

  // Add recency filter if specified
  if (recency) {
    requestBody.search_recency_filter = recency;
  }

  logger.info('Executing Perplexity research', { query: query.slice(0, 100), focus, recency });

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Perplexity API error', { status: response.status, error: errorText });
    throw new Error(`Perplexity API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as PerplexityResponse;

  const answer = data.choices[0]?.message?.content || 'No response received';
  const citations = data.citations || [];

  logger.info('Research completed', {
    tokensUsed: data.usage?.total_tokens || 0,
    citationCount: citations.length,
  });

  return {
    answer,
    citations,
    model: data.model,
    tokensUsed: data.usage?.total_tokens || 0,
  };
}

/**
 * Format research result for display
 */
function formatResearchResult(result: ResearchResult): string {
  let output = result.answer;

  if (result.citations.length > 0) {
    output += '\n\n---\n**Sources:**\n';
    result.citations.forEach((citation, index) => {
      const title = citation.title || citation.url;
      output += `${index + 1}. [${title}](${citation.url})\n`;
    });
  }

  return output;
}

/**
 * Perplexity Research Tool Definition
 */
export const perplexityResearchTool: AgentTool = {
  name: 'perplexity_research',
  description: `Search the web for real-time information using Perplexity AI. 
Returns up-to-date information with source citations. 
Use this for:
- Current events and news
- Latest technology updates
- Fact-checking and verification
- Product research and comparisons
- Academic and scientific queries`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The research query or question to search for',
      },
      focus: {
        type: 'string',
        enum: ['web', 'academic', 'news', 'youtube', 'reddit'],
        description: 'Focus area for research (default: web)',
      },
      recency: {
        type: 'string',
        enum: ['day', 'week', 'month', 'year'],
        description: 'Filter results by recency (optional)',
      },
    },
    required: ['query'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const query = params.query as string;
    const focus = params.focus as ResearchOptions['focus'];
    const recency = params.recency as ResearchOptions['recency'];

    if (!query) {
      return {
        success: false,
        error: 'Research query is required',
      };
    }

    try {
      const result = await executeResearch(query, { focus, recency });

      return {
        success: true,
        data: formatResearchResult(result),
        metadata: {
          model: result.model,
          tokensUsed: result.tokensUsed,
          citationCount: result.citations.length,
          citations: result.citations,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Research failed', { error: errorMessage });

      return {
        success: false,
        error: `Research failed: ${errorMessage}`,
      };
    }
  },
};

/**
 * Quick research function for internal use
 */
export async function quickResearch(query: string, focus?: ResearchOptions['focus']): Promise<string> {
  try {
    const result = await executeResearch(query, { focus, maxTokens: 1024 });
    return result.answer;
  } catch (error) {
    logger.error('Quick research failed', { error });
    throw error;
  }
}

/**
 * Check if Perplexity is configured
 */
export function isPerplexityConfigured(): boolean {
  const config = getConfig();
  return !!config.perplexityApiKey;
}

/**
 * Get all Perplexity research tools
 */
export function getPerplexityTools(): AgentTool[] {
  return [perplexityResearchTool];
}

export default perplexityResearchTool;
