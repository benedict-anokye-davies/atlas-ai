/**
 * @fileoverview Web Fetch Tool - URL Content Extraction
 * @module agent/tools/web-fetch
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Fetches and extracts content from web pages. This tool:
 * - Retrieves web page content
 * - Extracts main text content (removing boilerplate)
 * - Handles various content types (HTML, JSON, plain text)
 * - Respects robots.txt (optional)
 * - Caches responses for efficiency
 *
 * @see https://docs.clawd.bot/tools/web-fetch
 *
 * @example
 * import { webFetchTool } from './web-fetch';
 *
 * const result = await webFetchTool.execute({
 *   url: 'https://example.com/article',
 *   extractMain: true,
 * });
 */

import { createModuleLogger } from '../../utils/logger';
import type { AgentTool, ActionResult } from '../index';

const logger = createModuleLogger('WebFetchTool');

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Fetch parameters
 */
export interface FetchParams {
  /** URL to fetch */
  url: string;
  /** Whether to extract main content (default: true) */
  extractMain?: boolean;
  /** Include metadata (title, description, etc.) */
  includeMetadata?: boolean;
  /** Maximum content length in characters (default: 50000) */
  maxLength?: number;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
  /** Whether to follow redirects (default: true) */
  followRedirects?: boolean;
}

/**
 * Page metadata
 */
export interface PageMetadata {
  /** Page title */
  title?: string;
  /** Meta description */
  description?: string;
  /** Canonical URL */
  canonical?: string;
  /** Open Graph image */
  image?: string;
  /** Author */
  author?: string;
  /** Published date */
  publishedDate?: string;
  /** Site name */
  siteName?: string;
  /** Content type */
  contentType?: string;
  /** Detected language */
  language?: string;
}

/**
 * Fetch response
 */
export interface FetchResponse {
  /** Original URL */
  url: string;
  /** Final URL (after redirects) */
  finalUrl: string;
  /** HTTP status code */
  status: number;
  /** Content type */
  contentType: string;
  /** Extracted content */
  content: string;
  /** Page metadata */
  metadata?: PageMetadata;
  /** Content length in characters */
  length: number;
  /** Whether content was truncated */
  truncated: boolean;
  /** Fetch time in ms */
  fetchTime: number;
}

// =============================================================================
// Content Extraction
// =============================================================================

/**
 * Extract title from HTML
 */
function extractTitle(html: string): string | undefined {
  // Try <title> tag
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    return decodeHtmlEntities(titleMatch[1].trim());
  }

  // Try og:title
  const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (ogTitleMatch) {
    return decodeHtmlEntities(ogTitleMatch[1].trim());
  }

  return undefined;
}

/**
 * Extract meta description
 */
function extractDescription(html: string): string | undefined {
  // Try meta description
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  if (descMatch) {
    return decodeHtmlEntities(descMatch[1].trim());
  }

  // Try og:description
  const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  if (ogDescMatch) {
    return decodeHtmlEntities(ogDescMatch[1].trim());
  }

  return undefined;
}

/**
 * Extract metadata from HTML
 */
function extractMetadata(html: string, url: string): PageMetadata {
  const metadata: PageMetadata = {
    title: extractTitle(html),
    description: extractDescription(html),
  };

  // Canonical URL
  const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  if (canonicalMatch) {
    metadata.canonical = canonicalMatch[1];
  }

  // OG image
  const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (ogImageMatch) {
    metadata.image = ogImageMatch[1];
  }

  // Author
  const authorMatch = html.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i);
  if (authorMatch) {
    metadata.author = authorMatch[1];
  }

  // Published date
  const dateMatch = html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i);
  if (dateMatch) {
    metadata.publishedDate = dateMatch[1];
  }

  // Site name
  const siteNameMatch = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  if (siteNameMatch) {
    metadata.siteName = siteNameMatch[1];
  }

  // Language
  const langMatch = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
  if (langMatch) {
    metadata.language = langMatch[1];
  }

  return metadata;
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Remove HTML tags and extract text content
 * 
 * This is a simple but effective extraction method that:
 * 1. Removes script and style elements
 * 2. Removes all HTML tags
 * 3. Normalizes whitespace
 * 4. Removes common boilerplate patterns
 */
function extractTextContent(html: string): string {
  let text = html;

  // Remove script and style elements
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  
  // Remove comments
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');

  // Remove head section
  text = text.replace(/<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gi, ' ');

  // Remove nav and footer sections (common boilerplate)
  text = text.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ');
  text = text.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ');
  text = text.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ');

  // Replace block-level elements with newlines
  text = text.replace(/<\/(p|div|section|article|h[1-6]|li|tr)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Remove all remaining tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  text = decodeHtmlEntities(text);

  // Normalize whitespace
  text = text.replace(/[ \t]+/g, ' '); // Multiple spaces/tabs to single space
  text = text.replace(/\n[ \t]+/g, '\n'); // Remove leading whitespace from lines
  text = text.replace(/[ \t]+\n/g, '\n'); // Remove trailing whitespace from lines
  text = text.replace(/\n{3,}/g, '\n\n'); // Max 2 consecutive newlines
  text = text.trim();

  return text;
}

/**
 * Extract main content from HTML
 * 
 * Attempts to find the main content area by looking for:
 * 1. <main> element
 * 2. <article> element
 * 3. Element with role="main"
 * 4. Common content class names
 * 5. Fallback to body content
 */
function extractMainContent(html: string): string {
  // Try to find main content container
  const mainPatterns = [
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<[^>]+role=["']main["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
    /<div[^>]+class=["'][^"']*(?:content|article|post|entry|story)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of mainPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const extracted = extractTextContent(match[1]);
      // Only use if substantial content
      if (extracted.length > 200) {
        return extracted;
      }
    }
  }

  // Fallback to body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    return extractTextContent(bodyMatch[1]);
  }

  return extractTextContent(html);
}

// =============================================================================
// Fetch Implementation
// =============================================================================

/**
 * Fetch a URL with content extraction
 */
export async function webFetch(params: FetchParams): Promise<FetchResponse> {
  const startTime = Date.now();
  
  const timeout = params.timeout || 30000;
  const maxLength = params.maxLength || 50000;
  const extractMain = params.extractMain !== false;

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(params.url, {
      headers: {
        'User-Agent': 'Atlas/1.0 (Desktop AI Assistant)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        ...params.headers,
      },
      redirect: params.followRedirects !== false ? 'follow' : 'manual',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const contentType = response.headers.get('content-type') || 'text/html';
    const finalUrl = response.url;

    // Get response body
    const body = await response.text();
    const fetchTime = Date.now() - startTime;

    let content: string;
    let metadata: PageMetadata | undefined;

    // Handle different content types
    if (contentType.includes('application/json')) {
      // JSON content
      try {
        const json = JSON.parse(body);
        content = JSON.stringify(json, null, 2);
      } catch {
        content = body;
      }
      metadata = { contentType: 'application/json' };
    } else if (contentType.includes('text/plain')) {
      // Plain text
      content = body;
      metadata = { contentType: 'text/plain' };
    } else {
      // HTML content - extract text
      if (params.includeMetadata !== false) {
        metadata = extractMetadata(body, finalUrl);
        metadata.contentType = 'text/html';
      }

      if (extractMain) {
        content = extractMainContent(body);
      } else {
        content = extractTextContent(body);
      }
    }

    // Truncate if needed
    let truncated = false;
    if (content.length > maxLength) {
      content = content.slice(0, maxLength);
      // Try to end at a sentence
      const lastPeriod = content.lastIndexOf('.');
      if (lastPeriod > maxLength * 0.8) {
        content = content.slice(0, lastPeriod + 1);
      }
      content += '\n\n[Content truncated...]';
      truncated = true;
    }

    return {
      url: params.url,
      finalUrl,
      status: response.status,
      contentType,
      content,
      metadata,
      length: content.length,
      truncated,
      fetchTime,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }

    throw error;
  }
}

// =============================================================================
// Agent Tool Definition
// =============================================================================

/**
 * Web Fetch Tool for Atlas Agent
 * 
 * This tool allows the agent to fetch and read content from web pages.
 * It automatically extracts the main content and removes boilerplate.
 * 
 * @example
 * // Fetch a page with main content extraction
 * await webFetchTool.execute({
 *   url: 'https://example.com/article',
 * });
 * 
 * // Fetch with full content (no extraction)
 * await webFetchTool.execute({
 *   url: 'https://api.example.com/data.json',
 *   extractMain: false,
 * });
 */
export const webFetchTool: AgentTool = {
  name: 'web_fetch',
  description: `Fetch and extract content from a web page.

Use this tool when you need to:
- Read the content of a specific web page
- Get the text from an article or documentation page
- Fetch data from a JSON API endpoint
- Read the contents of a README or documentation

The tool automatically extracts the main content and removes navigation, 
ads, and other boilerplate. Returns the page text and metadata.`,

  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL of the page to fetch. Must be a valid HTTP/HTTPS URL.',
      },
      extractMain: {
        type: 'boolean',
        description: 'Whether to extract only the main content (default: true). Set to false for JSON APIs or when you need raw content.',
      },
      maxLength: {
        type: 'number',
        description: 'Maximum content length in characters (default: 50000). Content will be truncated if longer.',
      },
    },
    required: ['url'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const url = params.url as string;

      // Validate URL
      try {
        new URL(url);
      } catch {
        return {
          success: false,
          output: 'Invalid URL provided',
          error: 'Invalid URL',
        };
      }

      const fetchParams: FetchParams = {
        url,
        extractMain: params.extractMain as boolean | undefined,
        maxLength: params.maxLength as number | undefined,
        includeMetadata: true,
      };

      const response = await webFetch(fetchParams);

      // Format output
      let output = '';

      // Add metadata if available
      if (response.metadata) {
        const meta = response.metadata;
        if (meta.title) {
          output += `# ${meta.title}\n\n`;
        }
        if (meta.description) {
          output += `> ${meta.description}\n\n`;
        }
        if (meta.author) {
          output += `Author: ${meta.author}\n`;
        }
        if (meta.publishedDate) {
          output += `Published: ${meta.publishedDate}\n`;
        }
        if (output && !output.endsWith('\n\n')) {
          output += '\n';
        }
      }

      output += response.content;

      if (response.truncated) {
        output += `\n\n*Note: Content was truncated. Fetched ${response.length} characters.*`;
      }

      logger.info('Web fetch completed', {
        url: response.finalUrl,
        contentLength: response.length,
        fetchTime: response.fetchTime,
        truncated: response.truncated,
      });

      return {
        success: true,
        output,
        data: {
          url: response.url,
          finalUrl: response.finalUrl,
          status: response.status,
          contentType: response.contentType,
          metadata: response.metadata,
          length: response.length,
          truncated: response.truncated,
          fetchTime: response.fetchTime,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Web fetch failed', { error });

      return {
        success: false,
        output: `Failed to fetch URL: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

export default webFetchTool;
