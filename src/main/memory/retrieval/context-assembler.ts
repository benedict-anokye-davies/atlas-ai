/**
 * Atlas Desktop - Context Assembler
 * Assembles relevant context from semantic search results
 */

import { createModuleLogger } from '../../utils/logger';
import { EnhancedSearchResult, getSemanticSearchService, SearchContext } from './semantic-search';
import { VectorMetadata } from '../vector-store';

const logger = createModuleLogger('ContextAssembler');

/**
 * Context assembly options
 */
export interface ContextAssemblyOptions {
  /** Maximum context length in characters */
  maxLength?: number;
  /** Maximum number of documents to include */
  maxDocuments?: number;
  /** Include document metadata in context */
  includeMetadata?: boolean;
  /** Format style for context */
  format?: 'plain' | 'structured' | 'markdown';
  /** Prioritize by source type */
  prioritySourceTypes?: VectorMetadata['sourceType'][];
}

/**
 * Assembled context result
 */
export interface AssembledContext {
  /** The assembled context string */
  content: string;
  /** Documents included in context */
  includedDocuments: Array<{
    id: string;
    sourceType: VectorMetadata['sourceType'];
    importance: number;
    score: number;
  }>;
  /** Total documents considered */
  totalConsidered: number;
  /** Whether context was truncated */
  truncated: boolean;
  /** Estimated token count */
  estimatedTokens: number;
}

/**
 * Default assembly options
 */
const DEFAULT_OPTIONS: Required<ContextAssemblyOptions> = {
  maxLength: 4000,
  maxDocuments: 10,
  includeMetadata: false,
  format: 'structured',
  prioritySourceTypes: ['fact', 'preference', 'task', 'context', 'conversation', 'other'],
};

/**
 * Context Assembler
 * Builds LLM context from semantic search results
 */
export class ContextAssembler {
  constructor() {
    logger.info('ContextAssembler initialized');
  }

  /**
   * Assemble context from a query
   */
  async assembleFromQuery(
    query: string,
    searchContext?: SearchContext,
    options?: ContextAssemblyOptions
  ): Promise<AssembledContext> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const searchService = getSemanticSearchService();

    // Perform semantic search
    const results = searchContext
      ? await searchService.searchWithContext(query, searchContext, {
          limit: opts.maxDocuments * 2,
        })
      : await searchService.search(query, {
          limit: opts.maxDocuments * 2,
        });

    return this.assembleFromResults(results, opts);
  }

  /**
   * Assemble context from search results
   */
  assembleFromResults(
    results: EnhancedSearchResult[],
    options?: ContextAssemblyOptions
  ): AssembledContext {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Sort by priority (source type priority + score)
    const prioritized = this.prioritizeResults(results, opts.prioritySourceTypes);

    const includedDocuments: AssembledContext['includedDocuments'] = [];
    const parts: string[] = [];
    let currentLength = 0;
    let truncated = false;

    for (const result of prioritized) {
      if (includedDocuments.length >= opts.maxDocuments) {
        truncated = true;
        break;
      }

      const docContent = this.formatDocument(result, opts.format, opts.includeMetadata);

      // Check if adding this would exceed max length
      if (currentLength + docContent.length > opts.maxLength) {
        // Try to truncate the document
        const remaining = opts.maxLength - currentLength;
        if (remaining > 200) {
          // Worth truncating
          parts.push(docContent.slice(0, remaining - 3) + '...');
          currentLength = opts.maxLength;
          truncated = true;
        } else {
          truncated = true;
        }
        break;
      }

      parts.push(docContent);
      currentLength += docContent.length;

      includedDocuments.push({
        id: result.result.document.id,
        sourceType: result.result.document.metadata.sourceType,
        importance: result.result.document.metadata.importance,
        score: result.finalScore,
      });
    }

    const content = this.formatContext(parts, opts.format);

    return {
      content,
      includedDocuments,
      totalConsidered: results.length,
      truncated,
      estimatedTokens: Math.ceil(content.length / 4), // Rough estimate
    };
  }

  /**
   * Prioritize results by source type and score
   */
  private prioritizeResults(
    results: EnhancedSearchResult[],
    priorityTypes: VectorMetadata['sourceType'][]
  ): EnhancedSearchResult[] {
    return results.sort((a, b) => {
      const aTypeIndex = priorityTypes.indexOf(a.result.document.metadata.sourceType);
      const bTypeIndex = priorityTypes.indexOf(b.result.document.metadata.sourceType);

      // Primary sort: source type priority
      if (aTypeIndex !== bTypeIndex) {
        return aTypeIndex - bTypeIndex;
      }

      // Secondary sort: final score
      return b.finalScore - a.finalScore;
    });
  }

  /**
   * Format a single document for context
   */
  private formatDocument(
    result: EnhancedSearchResult,
    format: ContextAssemblyOptions['format'],
    includeMetadata: boolean
  ): string {
    const doc = result.result.document;

    switch (format) {
      case 'markdown':
        return this.formatMarkdown(doc, result, includeMetadata);
      case 'structured':
        return this.formatStructured(doc, result, includeMetadata);
      case 'plain':
      default:
        return this.formatPlain(doc, includeMetadata);
    }
  }

  /**
   * Format document as plain text
   */
  private formatPlain(
    doc: { content: string; metadata: VectorMetadata },
    includeMetadata: boolean
  ): string {
    if (includeMetadata) {
      return `[${doc.metadata.sourceType}] ${doc.content}`;
    }
    return doc.content;
  }

  /**
   * Format document as structured text
   */
  private formatStructured(
    doc: { content: string; metadata: VectorMetadata },
    result: EnhancedSearchResult,
    includeMetadata: boolean
  ): string {
    const lines: string[] = [];

    if (includeMetadata) {
      lines.push(`<${doc.metadata.sourceType} importance="${result.importanceScore.toFixed(2)}">`);
      lines.push(doc.content);
      lines.push(`</${doc.metadata.sourceType}>`);
    } else {
      lines.push(`[${doc.metadata.sourceType}]: ${doc.content}`);
    }

    return lines.join('\n');
  }

  /**
   * Format document as markdown
   */
  private formatMarkdown(
    doc: { content: string; metadata: VectorMetadata },
    result: EnhancedSearchResult,
    includeMetadata: boolean
  ): string {
    const lines: string[] = [];

    if (includeMetadata) {
      lines.push(`### ${this.capitalizeSourceType(doc.metadata.sourceType)}`);
      lines.push(`*Relevance: ${(result.finalScore * 100).toFixed(0)}%*`);
      lines.push('');
    }

    lines.push(doc.content);
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Capitalize source type for display
   */
  private capitalizeSourceType(sourceType: VectorMetadata['sourceType']): string {
    return sourceType.charAt(0).toUpperCase() + sourceType.slice(1);
  }

  /**
   * Format the final context
   */
  private formatContext(parts: string[], format: ContextAssemblyOptions['format']): string {
    switch (format) {
      case 'markdown':
        return parts.join('\n---\n');
      case 'structured':
        return parts.join('\n\n');
      case 'plain':
      default:
        return parts.join('\n\n');
    }
  }

  /**
   * Build context for LLM prompt
   */
  async buildLLMContext(
    userMessage: string,
    searchContext?: SearchContext,
    options?: ContextAssemblyOptions
  ): Promise<string> {
    const assembled = await this.assembleFromQuery(userMessage, searchContext, options);

    if (assembled.includedDocuments.length === 0) {
      return '';
    }

    // Wrap in context markers for LLM
    return `[Relevant context from memory:]\n${assembled.content}\n[End of context]`;
  }
}

// Singleton instance
let assembler: ContextAssembler | null = null;

/**
 * Get or create the context assembler
 */
export function getContextAssembler(): ContextAssembler {
  if (!assembler) {
    assembler = new ContextAssembler();
  }
  return assembler;
}

export default ContextAssembler;
