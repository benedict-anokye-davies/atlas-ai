/**
 * Atlas Desktop - Smart Context Builder
 *
 * Automatically builds relevant context for a coding task by analyzing
 * the codebase index to find related files, symbols, and type definitions.
 *
 * @module code-intelligence/context-builder
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createModuleLogger } from '../utils/logger';
import { getCodebaseIndexer, CodebaseIndexer } from './codebase-indexer';
import {
  TaskContext,
  RelevantFile,
  RelevanceScore,
  ContextBuildOptions,
  CodeSymbol,
  CodebaseIndex,
} from './types';

const logger = createModuleLogger('ContextBuilder');

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_OPTIONS: Required<ContextBuildOptions> = {
  maxTokens: 50000,
  maxFiles: 20,
  includeTypes: true,
  includeTests: false,
  alwaysInclude: [],
  exclude: [],
};

// Rough token estimation: ~4 chars per token
const CHARS_PER_TOKEN = 4;

// =============================================================================
// Context Builder Class
// =============================================================================

/**
 * Builds smart context for coding tasks.
 *
 * Analyzes the codebase to find files relevant to a task,
 * including imports, type definitions, and related code.
 *
 * @example
 * ```typescript
 * const builder = new SmartContextBuilder();
 *
 * const context = await builder.buildContext(
 *   'Add a new method to VoicePipeline that handles interruptions',
 *   { maxTokens: 30000 }
 * );
 *
 * // context.primaryFiles - Main files to modify
 * // context.supportingFiles - Related files for reference
 * // context.relevantSymbols - Key symbols involved
 * ```
 */
export class SmartContextBuilder {
  private indexer: CodebaseIndexer;

  constructor(indexer?: CodebaseIndexer) {
    this.indexer = indexer || getCodebaseIndexer();
  }

  /**
   * Build context for a task description
   */
  async buildContext(
    taskDescription: string,
    options: ContextBuildOptions = {}
  ): Promise<TaskContext> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Ensure index is ready
    if (!this.indexer.isReady()) {
      logger.info('Index not ready, building...');
      await this.indexer.buildIndex();
    }

    const index = this.indexer.getIndex()!;

    // Extract keywords and symbols from task
    const keywords = this.extractKeywords(taskDescription);
    const mentionedSymbols = this.findMentionedSymbols(keywords, index);

    logger.info('Building context', { keywords, symbolCount: mentionedSymbols.length });

    // Find relevant files
    const relevantFiles = await this.findRelevantFiles(
      mentionedSymbols,
      keywords,
      index,
      opts
    );

    // Separate into primary and supporting
    const primaryThreshold = 0.6;
    const primaryFiles = relevantFiles.filter((f) => f.relevance.score >= primaryThreshold);
    const supportingFiles = relevantFiles.filter(
      (f) => f.relevance.score < primaryThreshold && f.relevance.score >= 0.3
    );

    // Find type definitions if needed
    let typeDefinitions: CodeSymbol[] = [];
    if (opts.includeTypes) {
      typeDefinitions = this.findTypeDefinitions(mentionedSymbols, index);
    }

    // Calculate total tokens and truncate if needed
    let totalTokens = 0;
    const finalPrimary: RelevantFile[] = [];
    const finalSupporting: RelevantFile[] = [];
    let wasTruncated = false;

    // Add always-include files first
    for (const filePath of opts.alwaysInclude) {
      const resolved = path.isAbsolute(filePath)
        ? filePath
        : path.join(index.workspaceRoot, filePath);
      
      const tokenEst = await this.estimateFileTokens(resolved);
      if (totalTokens + tokenEst <= opts.maxTokens) {
        finalPrimary.push({
          path: resolved,
          relevance: { score: 1, factors: this.createFactors(1, 0, 0, 0, 0) },
          reason: 'Explicitly included',
          keySymbols: [],
          tokenEstimate: tokenEst,
        });
        totalTokens += tokenEst;
      }
    }

    // Add primary files
    for (const file of primaryFiles) {
      if (finalPrimary.length >= opts.maxFiles / 2) break;
      if (totalTokens + file.tokenEstimate > opts.maxTokens) {
        wasTruncated = true;
        break;
      }
      finalPrimary.push(file);
      totalTokens += file.tokenEstimate;
    }

    // Add supporting files
    for (const file of supportingFiles) {
      if (finalPrimary.length + finalSupporting.length >= opts.maxFiles) break;
      if (totalTokens + file.tokenEstimate > opts.maxTokens) {
        wasTruncated = true;
        break;
      }
      finalSupporting.push(file);
      totalTokens += file.tokenEstimate;
    }

    return {
      primaryFiles: finalPrimary,
      supportingFiles: finalSupporting,
      relevantSymbols: mentionedSymbols,
      typeDefinitions,
      totalTokens,
      wasTruncated,
    };
  }

  /**
   * Build context for modifying a specific file
   */
  async buildContextForFile(
    filePath: string,
    options: ContextBuildOptions = {}
  ): Promise<TaskContext> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    if (!this.indexer.isReady()) {
      await this.indexer.buildIndex();
    }

    const index = this.indexer.getIndex()!;
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(index.workspaceRoot, filePath);

    // Get the file's symbols
    const fileSymbols = this.indexer.getFileSymbols(absolutePath);

    // Get imports and importers
    const imports = this.indexer.getImports(absolutePath);
    const importers = this.indexer.getImporters(absolutePath);

    // Build relevant file list
    const relevantFiles: RelevantFile[] = [];

    // Add the target file as primary
    const targetTokens = await this.estimateFileTokens(absolutePath);
    relevantFiles.push({
      path: absolutePath,
      relevance: { score: 1, factors: this.createFactors(1, 1, 1, 1, 1) },
      reason: 'Target file',
      keySymbols: fileSymbols.map((s) => s.name),
      tokenEstimate: targetTokens,
    });

    // Add imported files
    for (const importPath of imports) {
      const tokenEst = await this.estimateFileTokens(importPath);
      relevantFiles.push({
        path: importPath,
        relevance: { score: 0.7, factors: this.createFactors(1, 0, 0.5, 0, 0) },
        reason: 'Imported by target',
        keySymbols: this.indexer.getFileSymbols(importPath).map((s) => s.name),
        tokenEstimate: tokenEst,
      });
    }

    // Add files that import this file
    for (const importerPath of importers) {
      const tokenEst = await this.estimateFileTokens(importerPath);
      relevantFiles.push({
        path: importerPath,
        relevance: { score: 0.5, factors: this.createFactors(0.8, 0, 0.3, 0, 0) },
        reason: 'Imports target',
        keySymbols: this.indexer.getFileSymbols(importerPath).map((s) => s.name),
        tokenEstimate: tokenEst,
      });
    }

    // Apply token limit
    let totalTokens = 0;
    const finalPrimary: RelevantFile[] = [];
    const finalSupporting: RelevantFile[] = [];
    let wasTruncated = false;

    for (const file of relevantFiles) {
      if (totalTokens + file.tokenEstimate > opts.maxTokens) {
        wasTruncated = true;
        break;
      }

      if (file.relevance.score >= 0.6) {
        finalPrimary.push(file);
      } else {
        finalSupporting.push(file);
      }
      totalTokens += file.tokenEstimate;
    }

    // Find type definitions
    const typeDefinitions = opts.includeTypes
      ? this.findTypeDefinitions(fileSymbols, index)
      : [];

    return {
      primaryFiles: finalPrimary,
      supportingFiles: finalSupporting,
      relevantSymbols: fileSymbols,
      typeDefinitions,
      totalTokens,
      wasTruncated,
    };
  }

  /**
   * Build context for a symbol (find all related code)
   */
  async buildContextForSymbol(
    symbolName: string,
    options: ContextBuildOptions = {}
  ): Promise<TaskContext> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    if (!this.indexer.isReady()) {
      await this.indexer.buildIndex();
    }

    const index = this.indexer.getIndex()!;

    // Find the symbol
    const symbols = this.indexer.findSymbol(symbolName);
    if (symbols.length === 0) {
      return {
        primaryFiles: [],
        supportingFiles: [],
        relevantSymbols: [],
        typeDefinitions: [],
        totalTokens: 0,
        wasTruncated: false,
      };
    }

    // Get references
    const references = this.indexer.findReferences(symbolName);

    // Build file list from definition and references
    const fileScores = new Map<string, number>();

    // Definition file is most relevant
    for (const symbol of symbols) {
      fileScores.set(symbol.filePath, 1);
    }

    // Reference files
    for (const ref of references) {
      const current = fileScores.get(ref.filePath) || 0;
      fileScores.set(ref.filePath, Math.max(current, 0.7));
    }

    // Build relevant files
    const relevantFiles: RelevantFile[] = [];
    for (const [filePath, score] of fileScores) {
      const tokenEst = await this.estimateFileTokens(filePath);
      relevantFiles.push({
        path: filePath,
        relevance: { score, factors: this.createFactors(0, score, 0, 0, 0) },
        reason: score === 1 ? 'Symbol definition' : 'Symbol reference',
        keySymbols: this.indexer.getFileSymbols(filePath).map((s) => s.name),
        tokenEstimate: tokenEst,
      });
    }

    // Sort by relevance
    relevantFiles.sort((a, b) => b.relevance.score - a.relevance.score);

    // Apply limits
    let totalTokens = 0;
    const finalPrimary: RelevantFile[] = [];
    const finalSupporting: RelevantFile[] = [];
    let wasTruncated = false;

    for (const file of relevantFiles) {
      if (totalTokens + file.tokenEstimate > opts.maxTokens) {
        wasTruncated = true;
        break;
      }

      if (file.relevance.score >= 0.6) {
        finalPrimary.push(file);
      } else {
        finalSupporting.push(file);
      }
      totalTokens += file.tokenEstimate;
    }

    const typeDefinitions = opts.includeTypes
      ? this.findTypeDefinitions(symbols, index)
      : [];

    return {
      primaryFiles: finalPrimary,
      supportingFiles: finalSupporting,
      relevantSymbols: symbols,
      typeDefinitions,
      totalTokens,
      wasTruncated,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Extract keywords from task description
   */
  private extractKeywords(text: string): string[] {
    // Remove common words and extract potential symbol names
    const stopWords = new Set([
      'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
      'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
      'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'that', 'this',
      'these', 'those', 'what', 'which', 'who', 'whom', 'whose', 'where',
      'when', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
      'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
      'same', 'so', 'than', 'too', 'very', 'just', 'add', 'create', 'make',
      'update', 'modify', 'change', 'fix', 'implement', 'new', 'method',
      'function', 'class', 'file', 'code',
    ]);

    // Extract words, preserving PascalCase and camelCase
    const words: string[] = [];

    // Find PascalCase/camelCase identifiers
    const identifierRegex = /[A-Z][a-zA-Z0-9]*|[a-z][a-zA-Z0-9]*/g;
    let match;
    while ((match = identifierRegex.exec(text)) !== null) {
      const word = match[0];
      if (!stopWords.has(word.toLowerCase()) && word.length > 2) {
        words.push(word);
      }
    }

    // Deduplicate
    return [...new Set(words)];
  }

  /**
   * Find symbols mentioned in keywords
   */
  private findMentionedSymbols(
    keywords: string[],
    _index: CodebaseIndex
  ): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const seen = new Set<string>();

    for (const keyword of keywords) {
      const found = this.indexer.findSymbol(keyword);
      for (const symbol of found) {
        if (!seen.has(symbol.qualifiedName)) {
          seen.add(symbol.qualifiedName);
          symbols.push(symbol);
        }
      }
    }

    return symbols;
  }

  /**
   * Find relevant files based on symbols and keywords
   */
  private async findRelevantFiles(
    symbols: CodeSymbol[],
    keywords: string[],
    index: CodebaseIndex,
    options: Required<ContextBuildOptions>
  ): Promise<RelevantFile[]> {
    const fileScores = new Map<string, RelevanceScore>();

    // Score files based on symbol definitions
    for (const symbol of symbols) {
      const current = fileScores.get(symbol.filePath);
      if (!current || current.score < 0.9) {
        fileScores.set(symbol.filePath, {
          score: 0.9,
          factors: this.createFactors(0, 1, 0, 0, 0),
        });
      }
    }

    // Score files based on symbol references
    for (const symbol of symbols) {
      const refs = this.indexer.findReferences(symbol.name);
      for (const ref of refs) {
        const current = fileScores.get(ref.filePath);
        if (!current || current.score < 0.7) {
          fileScores.set(ref.filePath, {
            score: 0.7,
            factors: this.createFactors(0, 0.8, 0, 0, 0),
          });
        }
      }
    }

    // Score files based on keyword matches in path
    for (const [filePath] of index.files) {
      const fileName = path.basename(filePath).toLowerCase();
      for (const keyword of keywords) {
        if (fileName.includes(keyword.toLowerCase())) {
          const current = fileScores.get(filePath);
          const newScore = 0.5;
          if (!current || current.score < newScore) {
            fileScores.set(filePath, {
              score: newScore,
              factors: this.createFactors(0, 0, 0, 0.8, 0),
            });
          }
        }
      }
    }

    // Build result list
    const files: RelevantFile[] = [];
    for (const [filePath, relevance] of fileScores) {
      // Apply exclusions
      if (options.exclude.some((p) => filePath.includes(p))) {
        continue;
      }

      // Skip tests unless requested
      if (!options.includeTests && this.isTestFile(filePath)) {
        continue;
      }

      const tokenEst = await this.estimateFileTokens(filePath);
      const fileSymbols = this.indexer.getFileSymbols(filePath);

      files.push({
        path: filePath,
        relevance,
        reason: this.getRelevanceReason(relevance),
        keySymbols: fileSymbols.slice(0, 5).map((s) => s.name),
        tokenEstimate: tokenEst,
      });
    }

    // Sort by relevance
    files.sort((a, b) => b.relevance.score - a.relevance.score);

    return files;
  }

  /**
   * Find type definitions for symbols
   */
  private findTypeDefinitions(
    symbols: CodeSymbol[],
    _index: CodebaseIndex
  ): CodeSymbol[] {
    const types: CodeSymbol[] = [];
    const seen = new Set<string>();

    for (const symbol of symbols) {
      // Look for interface/type with similar name
      const typeName = symbol.name + 'Type';
      const interfaceName = 'I' + symbol.name;

      for (const name of [symbol.name, typeName, interfaceName]) {
        const found = this.indexer.findSymbol(name);
        for (const s of found) {
          if (
            (s.kind === 'interface' || s.kind === 'type') &&
            !seen.has(s.qualifiedName)
          ) {
            seen.add(s.qualifiedName);
            types.push(s);
          }
        }
      }
    }

    return types;
  }

  /**
   * Estimate token count for a file
   */
  private async estimateFileTokens(filePath: string): Promise<number> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return Math.ceil(content.length / CHARS_PER_TOKEN);
    } catch {
      return 0;
    }
  }

  /**
   * Check if a file is a test file
   */
  private isTestFile(filePath: string): boolean {
    const name = path.basename(filePath).toLowerCase();
    return (
      name.includes('.test.') ||
      name.includes('.spec.') ||
      name.includes('__tests__') ||
      filePath.includes('/tests/') ||
      filePath.includes('\\tests\\')
    );
  }

  /**
   * Create a factors object
   */
  private createFactors(
    importRelation: number,
    symbolReference: number,
    proximity: number,
    namingSimilarity: number,
    recentEdit: number
  ): RelevanceScore['factors'] {
    return {
      importRelation,
      symbolReference,
      proximity,
      namingSimilarity,
      recentEdit,
    };
  }

  /**
   * Get human-readable reason for relevance
   */
  private getRelevanceReason(relevance: RelevanceScore): string {
    const { factors } = relevance;

    if (factors.symbolReference > 0.8) {
      return 'Contains symbol definition';
    }
    if (factors.symbolReference > 0.5) {
      return 'References relevant symbols';
    }
    if (factors.importRelation > 0.8) {
      return 'Import relationship';
    }
    if (factors.namingSimilarity > 0.5) {
      return 'Similar naming';
    }
    if (factors.proximity > 0.5) {
      return 'Same directory';
    }
    if (factors.recentEdit > 0.5) {
      return 'Recently edited';
    }

    return 'Potentially relevant';
  }
}

// =============================================================================
// Singleton
// =============================================================================

let builderInstance: SmartContextBuilder | null = null;

/**
 * Get the smart context builder singleton
 */
export function getSmartContextBuilder(): SmartContextBuilder {
  if (!builderInstance) {
    builderInstance = new SmartContextBuilder();
  }
  return builderInstance;
}

/**
 * Reset the builder (for testing)
 */
export function resetSmartContextBuilder(): void {
  builderInstance = null;
}
