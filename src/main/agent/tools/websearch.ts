/**
 * Atlas Desktop - Web Search Tool
 * Search the web using DuckDuckGo (no API key required)
 */

import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import * as https from 'https';
import * as http from 'http';

const logger = createModuleLogger('WebSearchTool');

/**
 * Search result interface
 */
interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Simple HTTPS GET request
 */
function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    const req = protocol.get(
      url,
      {
        headers: {
          'User-Agent': 'Nova Desktop Agent/1.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      },
      (res) => {
        // Handle redirects
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            httpsGet(redirectUrl).then(resolve).catch(reject);
            return;
          }
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve(data));
      }
    );

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Parse DuckDuckGo HTML results
 */
function parseDuckDuckGoResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // Simple regex-based parsing for DuckDuckGo HTML results
  // Look for result links
  const resultPattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  const snippetPattern =
    /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([^<]+(?:<[^>]+>[^<]*<\/[^>]+>)*[^<]*)<\/a>/gi;

  let match;
  const urls: string[] = [];
  const titles: string[] = [];
  const snippets: string[] = [];

  // Extract URLs and titles
  while ((match = resultPattern.exec(html)) !== null) {
    let url = match[1];
    // DuckDuckGo wraps URLs in a redirect
    const uddgMatch = url.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      url = decodeURIComponent(uddgMatch[1]);
    }
    urls.push(url);
    titles.push(match[2].replace(/<[^>]+>/g, '').trim());
  }

  // Extract snippets
  while ((match = snippetPattern.exec(html)) !== null) {
    snippets.push(match[1].replace(/<[^>]+>/g, '').trim());
  }

  // Combine results
  for (let i = 0; i < Math.min(urls.length, titles.length); i++) {
    if (urls[i] && titles[i]) {
      results.push({
        url: urls[i],
        title: titles[i],
        snippet: snippets[i] || '',
      });
    }
  }

  return results;
}

/**
 * Web search tool using DuckDuckGo
 */
export const webSearchTool: AgentTool = {
  name: 'web_search',
  description: 'Search the web using DuckDuckGo and return relevant results',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results to return (default: 5, max: 10)',
      },
    },
    required: ['query'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const query = params.query as string;
    const maxResults = Math.min((params.maxResults as number) || 5, 10);

    if (!query || query.trim().length === 0) {
      return { success: false, error: 'Search query cannot be empty' };
    }

    try {
      // Use DuckDuckGo HTML search
      const encodedQuery = encodeURIComponent(query);
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

      logger.debug('Performing web search', { query });

      const html = await httpsGet(searchUrl);
      const results = parseDuckDuckGoResults(html).slice(0, maxResults);

      if (results.length === 0) {
        logger.warn('No search results found', { query });
        return {
          success: true,
          data: {
            query,
            results: [],
            message: 'No results found for this query',
          },
        };
      }

      logger.info('Web search completed', { query, resultCount: results.length });

      return {
        success: true,
        data: {
          query,
          results,
          resultCount: results.length,
        },
      };
    } catch (error) {
      logger.error('Web search failed', { query, error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Fetch URL content tool
 */
export const fetchUrlTool: AgentTool = {
  name: 'fetch_url',
  description: 'Fetch the content of a URL and return the text',
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
    },
    required: ['url'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const url = params.url as string;
    const maxLength = (params.maxLength as number) || 10000;

    // Basic URL validation
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, error: 'Only HTTP and HTTPS URLs are supported' };
      }

      // Block local/internal URLs
      if (
        /localhost|127\.0\.0\.1|192\.168\.|10\.\d|172\.(1[6-9]|2\d|3[01])/.test(parsed.hostname)
      ) {
        return { success: false, error: 'Cannot fetch local/internal URLs' };
      }
    } catch {
      return { success: false, error: 'Invalid URL format' };
    }

    try {
      logger.debug('Fetching URL', { url });

      const html = await httpsGet(url);

      // Simple HTML to text conversion
      let text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();

      const truncated = text.length > maxLength;
      text = text.slice(0, maxLength);

      logger.info('URL fetched', { url, length: text.length, truncated });

      return {
        success: true,
        data: {
          url,
          content: text,
          length: text.length,
          truncated,
        },
      };
    } catch (error) {
      logger.error('URL fetch failed', { url, error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Get all web search tools
 */
export function getWebSearchTools(): AgentTool[] {
  return [webSearchTool, fetchUrlTool];
}

export default {
  webSearchTool,
  fetchUrlTool,
  getWebSearchTools,
};
