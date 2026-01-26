/**
 * Atlas Desktop - Web Search Tools
 * Search the web using various search engines
 */

import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('SearchTools');

/**
 * Search result interface
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  position: number;
}

/**
 * Search response interface
 */
export interface SearchResponse {
  query: string;
  results: SearchResult[];
  totalResults: number;
  searchEngine: string;
  timestamp: string;
}

/**
 * Simple HTML parsing to extract text
 */
function extractText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse DuckDuckGo HTML results
 */
function parseDuckDuckGoResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  let position = 1;

  // Simple extraction - in production would use proper HTML parser
  const links = html.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*>[^<]+<\/a>/gi) || [];
  const snippets = html.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>[^<]+/gi) || [];

  for (let i = 0; i < Math.min(links.length, 10); i++) {
    const linkMatch = links[i].match(/href="([^"]+)"[^>]*>([^<]+)/i);
    if (linkMatch) {
      results.push({
        title: extractText(linkMatch[2]),
        url: linkMatch[1],
        snippet: snippets[i] ? extractText(snippets[i]) : '',
        position: position++,
      });
    }
  }

  return results;
}

/**
 * Web search using DuckDuckGo (no API key required)
 */
export const webSearchTool: AgentTool = {
  name: 'web_search',
  description:
    'Search the web using DuckDuckGo. Returns search results with titles, URLs, and snippets.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query string',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results to return (default: 5, max: 10)',
      },
      region: {
        type: 'string',
        description: 'Region code for localized results (e.g., "us-en", "uk-en")',
      },
    },
    required: ['query'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const query = params.query as string;
      const maxResults = Math.min((params.maxResults as number) || 5, 10);
      const region = (params.region as string) || 'us-en';

      if (!query || query.trim().length === 0) {
        return { success: false, error: 'Search query cannot be empty' };
      }

      // URL encode the query
      const encodedQuery = encodeURIComponent(query);
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodedQuery}&kl=${region}`;

      // Fetch search results
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Nova-Desktop/1.0 (AI Assistant)',
          Accept: 'text/html',
        },
      });

      if (!response.ok) {
        return { success: false, error: `Search request failed: ${response.status}` };
      }

      const html = await response.text();
      const allResults = parseDuckDuckGoResults(html);
      const results = allResults.slice(0, maxResults);

      const searchResponse: SearchResponse = {
        query,
        results,
        totalResults: results.length,
        searchEngine: 'DuckDuckGo',
        timestamp: new Date().toISOString(),
      };

      logger.info('Web search completed', { query, resultCount: results.length });

      return {
        success: true,
        data: searchResponse,
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Web search failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Fetch URL content tool
 */
export const fetchUrlTool: AgentTool = {
  name: 'fetch_url',
  description: 'Fetch content from a URL and extract the text. Useful for reading web pages.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch',
      },
      maxLength: {
        type: 'number',
        description: 'Maximum content length to return (default: 10000)',
      },
      extractText: {
        type: 'boolean',
        description: 'Extract plain text from HTML (default: true)',
      },
    },
    required: ['url'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const url = params.url as string;
      const maxLength = (params.maxLength as number) || 10000;
      const shouldExtractText = params.extractText !== false;

      // Validate URL
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return { success: false, error: 'Invalid URL format' };
      }

      // Block dangerous protocols
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return { success: false, error: 'Only HTTP/HTTPS URLs are allowed' };
      }

      // Fetch the URL
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Nova-Desktop/1.0 (AI Assistant)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
      }

      const contentType = response.headers.get('content-type') || '';
      let content = await response.text();

      // Extract text from HTML if requested
      if (shouldExtractText && contentType.includes('text/html')) {
        content = extractText(content);
      }

      // Truncate if needed
      const truncated = content.length > maxLength;
      if (truncated) {
        content = content.substring(0, maxLength) + '...';
      }

      logger.info('URL fetched', { url, contentLength: content.length });

      return {
        success: true,
        data: {
          url: response.url, // Final URL after redirects
          contentType,
          content,
          length: content.length,
          truncated,
          status: response.status,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('URL fetch failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Get all search tools
 */
export function getSearchTools(): AgentTool[] {
  return [webSearchTool, fetchUrlTool];
}

export default {
  getSearchTools,
  webSearchTool,
  fetchUrlTool,
};
