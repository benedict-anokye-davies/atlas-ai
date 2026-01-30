/**
 * @fileoverview Web Search Tool - Brave Search Integration
 * @module agent/tools/web-search
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Provides web search capabilities using the Brave Search API. This is the
 * primary web search tool for Atlas, offering:
 * - Web search with configurable result count
 * - News search
 * - Image search (coming soon)
 * - Search result caching
 * - Fallback to DuckDuckGo if Brave API unavailable
 *
 * Requires BRAVE_API_KEY environment variable or settings configuration.
 *
 * @see https://api.search.brave.com/app/documentation/web-search/get-started
 *
 * @example
 * import { webSearchTool } from './web-search';
 *
 * const result = await webSearchTool.execute({
 *   query: 'TypeScript best practices 2025',
 *   count: 10,
 * });
 */

import { createModuleLogger } from '../../utils/logger';
import type { AgentTool, ActionResult } from '../index';

const logger = createModuleLogger('WebSearchTool');

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Web search result
 */
export interface WebSearchResult {
  /** Result title */
  title: string;
  /** Result URL */
  url: string;
  /** Result description/snippet */
  description: string;
  /** Optional favicon URL */
  favicon?: string;
  /** Optional published date */
  publishedDate?: string;
  /** Optional source name */
  source?: string;
}

/**
 * Search response
 */
export interface SearchResponse {
  /** Search query */
  query: string;
  /** Search results */
  results: WebSearchResult[];
  /** Total estimated results */
  totalResults?: number;
  /** Search type */
  type: 'web' | 'news' | 'images';
  /** Response time in ms */
  responseTime: number;
  /** Provider used */
  provider: 'brave' | 'duckduckgo' | 'cached';
}

/**
 * Search parameters
 */
export interface SearchParams {
  /** Search query */
  query: string;
  /** Number of results (default: 10, max: 20) */
  count?: number;
  /** Search type */
  type?: 'web' | 'news';
  /** Country code for localized results (e.g., 'US', 'GB') */
  country?: string;
  /** Safe search setting */
  safeSearch?: 'off' | 'moderate' | 'strict';
  /** Freshness filter */
  freshness?: 'day' | 'week' | 'month' | 'year';
}

/**
 * Brave Search API response types
 */
interface BraveWebResult {
  title: string;
  url: string;
  description: string;
  favicon?: string;
  age?: string;
  profile?: {
    name: string;
  };
}

interface BraveNewsResult {
  title: string;
  url: string;
  description: string;
  thumbnail?: {
    src: string;
  };
  age?: string;
  source?: string;
}

interface BraveSearchResponse {
  query?: {
    original: string;
  };
  web?: {
    results: BraveWebResult[];
  };
  news?: {
    results: BraveNewsResult[];
  };
  mixed?: {
    main: Array<{ type: string; index: number }>;
  };
}

// =============================================================================
// Search Cache
// =============================================================================

/**
 * Simple in-memory cache for search results
 * 
 * NOTE: Cache entries expire after 15 minutes to ensure freshness
 * while reducing API calls for repeated queries.
 */
const searchCache = new Map<
  string,
  {
    response: SearchResponse;
    timestamp: number;
  }
>();

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Get cache key for a search request
 */
function getCacheKey(params: SearchParams): string {
  return JSON.stringify({
    q: params.query.toLowerCase().trim(),
    t: params.type || 'web',
    c: params.count || 10,
    cc: params.country || 'US',
  });
}

/**
 * Get cached result if valid
 */
function getCachedResult(params: SearchParams): SearchResponse | null {
  const key = getCacheKey(params);
  const cached = searchCache.get(key);

  if (!cached) {
    return null;
  }

  // Check if expired
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }

  return { ...cached.response, provider: 'cached' };
}

/**
 * Cache a search result
 */
function cacheResult(params: SearchParams, response: SearchResponse): void {
  const key = getCacheKey(params);
  searchCache.set(key, {
    response,
    timestamp: Date.now(),
  });

  // Limit cache size
  if (searchCache.size > 100) {
    // Remove oldest entries
    const entries = Array.from(searchCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    for (let i = 0; i < 20; i++) {
      searchCache.delete(entries[i][0]);
    }
  }
}

// =============================================================================
// Search Implementation
// =============================================================================

/**
 * Search using Brave Search API
 */
async function searchWithBrave(params: SearchParams): Promise<SearchResponse> {
  const apiKey = process.env.BRAVE_API_KEY;
  
  if (!apiKey) {
    throw new Error('BRAVE_API_KEY not configured');
  }

  const startTime = Date.now();

  // Build query parameters
  const queryParams = new URLSearchParams({
    q: params.query,
    count: String(Math.min(params.count || 10, 20)),
    country: params.country || 'US',
    safesearch: params.safeSearch || 'moderate',
    text_decorations: 'false', // Plain text snippets
    result_filter: params.type === 'news' ? 'news' : 'web',
  });

  if (params.freshness) {
    queryParams.set('freshness', params.freshness);
  }

  const endpoint = params.type === 'news'
    ? 'https://api.search.brave.com/res/v1/news/search'
    : 'https://api.search.brave.com/res/v1/web/search';

  const response = await fetch(`${endpoint}?${queryParams}`, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Brave Search API error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as BraveSearchResponse;
  const responseTime = Date.now() - startTime;

  // Parse results based on type
  let results: WebSearchResult[];

  if (params.type === 'news' && data.news?.results) {
    results = data.news.results.map((r) => ({
      title: r.title,
      url: r.url,
      description: r.description,
      publishedDate: r.age,
      source: r.source,
    }));
  } else if (data.web?.results) {
    results = data.web.results.map((r) => ({
      title: r.title,
      url: r.url,
      description: r.description,
      favicon: r.favicon,
      source: r.profile?.name,
    }));
  } else {
    results = [];
  }

  return {
    query: params.query,
    results,
    type: params.type || 'web',
    responseTime,
    provider: 'brave',
  };
}

/**
 * Fallback search using DuckDuckGo Instant Answer API
 * 
 * NOTE: DuckDuckGo Instant Answer API is limited compared to Brave Search.
 * It returns abstract/summary information rather than full search results.
 * This is a best-effort fallback when Brave API is unavailable.
 */
async function searchWithDuckDuckGo(params: SearchParams): Promise<SearchResponse> {
  const startTime = Date.now();

  const queryParams = new URLSearchParams({
    q: params.query,
    format: 'json',
    no_html: '1',
    skip_disambig: '1',
  });

  const response = await fetch(
    `https://api.duckduckgo.com/?${queryParams}`,
    {
      headers: {
        'Accept': 'application/json',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`DuckDuckGo API error: ${response.status}`);
  }

  const data = await response.json();
  const responseTime = Date.now() - startTime;

  const results: WebSearchResult[] = [];

  // Add abstract result if available
  if (data.AbstractText && data.AbstractURL) {
    results.push({
      title: data.Heading || params.query,
      url: data.AbstractURL,
      description: data.AbstractText,
      source: data.AbstractSource,
    });
  }

  // Add related topics
  if (data.RelatedTopics) {
    for (const topic of data.RelatedTopics.slice(0, (params.count || 10) - 1)) {
      if (topic.FirstURL && topic.Text) {
        results.push({
          title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 50),
          url: topic.FirstURL,
          description: topic.Text,
        });
      }
    }
  }

  return {
    query: params.query,
    results,
    type: 'web',
    responseTime,
    provider: 'duckduckgo',
  };
}

/**
 * Main search function with caching and fallback
 */
export async function webSearch(params: SearchParams): Promise<SearchResponse> {
  // Check cache first
  const cached = getCachedResult(params);
  if (cached) {
    logger.debug('Cache hit for search', { query: params.query });
    return cached;
  }

  try {
    // Try Brave Search first
    const result = await searchWithBrave(params);
    
    // Cache successful result
    cacheResult(params, result);
    
    logger.info('Brave search completed', {
      query: params.query,
      resultCount: result.results.length,
      responseTime: result.responseTime,
    });

    return result;
  } catch (error) {
    logger.warn('Brave search failed, falling back to DuckDuckGo', { error });

    try {
      // Fallback to DuckDuckGo
      const result = await searchWithDuckDuckGo(params);
      
      logger.info('DuckDuckGo fallback completed', {
        query: params.query,
        resultCount: result.results.length,
      });

      return result;
    } catch (fallbackError) {
      logger.error('All search providers failed', { error: fallbackError });
      throw new Error('Search failed: All providers unavailable');
    }
  }
}

// =============================================================================
// Agent Tool Definition
// =============================================================================

/**
 * Web Search Tool for Atlas Agent
 * 
 * This tool allows the agent to search the web for information.
 * It uses Brave Search API as the primary provider with DuckDuckGo fallback.
 * 
 * @example
 * // Basic web search
 * await webSearchTool.execute({ query: 'Electron best practices' });
 * 
 * // News search with freshness filter
 * await webSearchTool.execute({
 *   query: 'AI announcements',
 *   type: 'news',
 *   freshness: 'week',
 * });
 */
export const webSearchTool: AgentTool = {
  name: 'web_search',
  description: `Search the web for information using Brave Search.

Use this tool when you need to:
- Find current information about a topic
- Look up documentation or tutorials
- Find news articles
- Research facts or statistics
- Find solutions to technical problems

Returns a list of search results with titles, URLs, and descriptions.`,

  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query. Be specific for better results.',
      },
      count: {
        type: 'number',
        description: 'Number of results to return (1-20, default: 10)',
      },
      type: {
        type: 'string',
        enum: ['web', 'news'],
        description: 'Type of search: "web" for general search, "news" for news articles',
      },
      freshness: {
        type: 'string',
        enum: ['day', 'week', 'month', 'year'],
        description: 'Filter results by recency',
      },
    },
    required: ['query'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const searchParams: SearchParams = {
        query: params.query as string,
        count: params.count as number | undefined,
        type: params.type as 'web' | 'news' | undefined,
        freshness: params.freshness as 'day' | 'week' | 'month' | 'year' | undefined,
      };

      const response = await webSearch(searchParams);

      // Format results for the agent
      const formattedResults = response.results.map((r, i) => ({
        index: i + 1,
        title: r.title,
        url: r.url,
        snippet: r.description,
        source: r.source,
        date: r.publishedDate,
      }));

      return {
        success: true,
        output: `Found ${response.results.length} results for "${searchParams.query}":

${formattedResults.map((r) => `${r.index}. **${r.title}**
   ${r.url}
   ${r.snippet}${r.source ? ` (Source: ${r.source})` : ''}${r.date ? ` - ${r.date}` : ''}`).join('\n\n')}`,
        data: {
          query: response.query,
          results: formattedResults,
          totalResults: response.results.length,
          provider: response.provider,
          responseTime: response.responseTime,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Web search tool failed', { error });

      return {
        success: false,
        output: `Search failed: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

export default webSearchTool;
