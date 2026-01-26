/**
 * Atlas Desktop - Lance Sync
 * Sync Obsidian vault notes with LanceDB vector store
 */

import * as path from 'path';
import { getVaultPath, getAllNotes, VaultDirectory } from './obsidian-brain';
import { readNote, NoteMetadata } from './note-writer';
import { LanceDBVectorStore } from './vector-store/lancedb';
import { getEmbeddingGenerator, EmbeddingGenerator } from './vector-store/embeddings';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('LanceSync');

/**
 * Search options for vault search
 */
export interface VaultSearchOptions {
  /** Maximum number of results */
  limit?: number;
  /** Filter by vault directory */
  directory?: VaultDirectory;
  /** Filter by note type */
  type?: string;
  /** Minimum similarity score (0-1) */
  minScore?: number;
  /** Only include notes modified after this date */
  since?: Date;
}

/**
 * Search result from vault
 */
export interface VaultSearchResult {
  /** Relative path to the note */
  path: string;
  /** Note title */
  title: string;
  /** Note type from frontmatter */
  type: string;
  /** Similarity score (0-1) */
  score: number;
  /** Relevant excerpt from the note */
  excerpt: string;
  /** Full metadata */
  metadata: NoteMetadata;
}

/**
 * Index status for a note
 */
export interface NoteIndexStatus {
  path: string;
  indexed: boolean;
  lastIndexed?: number;
  error?: string;
}

/**
 * Lance Sync Manager
 * Handles syncing between Obsidian vault and LanceDB
 */
export class LanceSyncManager {
  private vectorStore: LanceDBVectorStore | null = null;
  private embeddingGenerator: EmbeddingGenerator | null = null;
  private isInitialized = false;
  private indexedNotes: Map<string, number> = new Map(); // path -> lastModified

  constructor() {
    logger.info('LanceSyncManager created');
  }

  /**
   * Initialize the sync manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Initialize vector store
      this.vectorStore = new LanceDBVectorStore({
        storageDir: path.join(getVaultPath(), '..', 'vectors'),
        dimensions: 768, // nomic-embed-text-v1.5 dimensions
      });
      await this.vectorStore.initialize();

      // Initialize embedding generator
      this.embeddingGenerator = await getEmbeddingGenerator({
        dimensions: 768,
      });

      this.isInitialized = true;
      logger.info('LanceSyncManager initialized');
    } catch (error) {
      logger.error('Failed to initialize LanceSyncManager', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Ensure initialization
   */
  private ensureInitialized(): void {
    if (!this.isInitialized || !this.vectorStore || !this.embeddingGenerator) {
      throw new Error('LanceSyncManager not initialized');
    }
  }

  /**
   * Index a single note
   */
  async indexNote(notePath: string): Promise<NoteIndexStatus> {
    this.ensureInitialized();

    const status: NoteIndexStatus = {
      path: notePath,
      indexed: false,
    };

    try {
      // Read the note
      const note = await readNote(notePath);
      if (!note) {
        status.error = 'Note not found';
        return status;
      }

      // Extract content for embedding
      const title = note.metadata.title || path.basename(notePath, '.md');
      const content = note.content;
      const type = note.metadata.type || 'unknown';

      // Combine title and content for better semantic search
      const textToEmbed = `${title}\n\n${content}`.slice(0, 8000); // Limit text length

      // Generate embedding
      const embeddingResult = await this.embeddingGenerator!.embed(textToEmbed);

      // Create document ID from path
      const docId = this.pathToId(notePath);

      // Check if document exists and delete it first (for updates)
      try {
        await this.vectorStore!.delete(docId);
      } catch {
        // Document may not exist, which is fine
      }

      // Add to vector store
      await this.vectorStore!.add(docId, embeddingResult.vector, content, {
        sourceType: 'other', // Use 'other' as vault notes
        importance: this.calculateNoteImportance(note.metadata),
        tags: note.metadata.tags,
        custom: {
          notePath,
          title,
          type,
          directory: path.dirname(notePath),
          lastModified: note.metadata.last_modified,
        },
      });

      // Track indexed note
      this.indexedNotes.set(notePath, Date.now());

      status.indexed = true;
      status.lastIndexed = Date.now();

      logger.debug('Note indexed', { path: notePath, title });

      return status;
    } catch (error) {
      status.error = (error as Error).message;
      logger.error('Failed to index note', {
        path: notePath,
        error: status.error,
      });
      return status;
    }
  }

  /**
   * Reindex all notes in the vault
   */
  async reindexAll(): Promise<{
    total: number;
    indexed: number;
    failed: number;
    errors: Record<string, string>;
  }> {
    this.ensureInitialized();

    const notes = await getAllNotes();
    const result = {
      total: notes.length,
      indexed: 0,
      failed: 0,
      errors: {} as Record<string, string>,
    };

    logger.info('Starting full vault reindex', { totalNotes: notes.length });

    for (const notePath of notes) {
      const status = await this.indexNote(notePath);
      if (status.indexed) {
        result.indexed++;
      } else {
        result.failed++;
        if (status.error) {
          result.errors[notePath] = status.error;
        }
      }
    }

    logger.info('Vault reindex complete', {
      indexed: result.indexed,
      failed: result.failed,
    });

    return result;
  }

  /**
   * Remove a note from the index
   */
  async removeFromIndex(notePath: string): Promise<boolean> {
    this.ensureInitialized();

    const docId = this.pathToId(notePath);
    const deleted = await this.vectorStore!.delete(docId);
    this.indexedNotes.delete(notePath);

    logger.debug('Note removed from index', { path: notePath, deleted });

    return deleted;
  }

  /**
   * Search for similar notes
   */
  async searchNotes(query: string, options: VaultSearchOptions = {}): Promise<VaultSearchResult[]> {
    this.ensureInitialized();

    const limit = options.limit || 10;
    const minScore = options.minScore || 0.3;

    // Generate query embedding
    const queryEmbedding = await this.embeddingGenerator!.embed(query);

    // Search vector store
    const searchResults = await this.vectorStore!.search(queryEmbedding.vector, {
      limit: limit * 2, // Over-fetch for filtering
      minScore,
    });

    const results: VaultSearchResult[] = [];

    for (const result of searchResults) {
      const custom = result.document.metadata.custom as {
        notePath: string;
        title: string;
        type: string;
        directory: string;
        lastModified?: string;
      };

      if (!custom?.notePath) continue;

      // Apply directory filter
      if (options.directory && !custom.notePath.startsWith(options.directory)) {
        continue;
      }

      // Apply type filter
      if (options.type && custom.type !== options.type) {
        continue;
      }

      // Apply date filter
      if (options.since && custom.lastModified) {
        const noteDate = new Date(custom.lastModified);
        if (noteDate < options.since) continue;
      }

      // Generate excerpt
      const excerpt = this.generateExcerpt(result.document.content, query);

      results.push({
        path: custom.notePath,
        title: custom.title,
        type: custom.type,
        score: result.score,
        excerpt,
        metadata: {
          type: custom.type,
          title: custom.title,
          last_modified: custom.lastModified,
        },
      });

      if (results.length >= limit) break;
    }

    logger.debug('Vault search completed', {
      query: query.slice(0, 50),
      results: results.length,
    });

    return results;
  }

  /**
   * Get knowledge about a topic
   * Combines relevant excerpts from multiple notes
   */
  async getKnowledgeAbout(topic: string, maxNotes: number = 5): Promise<string> {
    const results = await this.searchNotes(topic, { limit: maxNotes });

    if (results.length === 0) {
      return `No knowledge found about: ${topic}`;
    }

    const sections: string[] = [];

    for (const result of results) {
      sections.push(
        `## From "${result.title}" (${(result.score * 100).toFixed(0)}% relevance)\n\n${result.excerpt}`
      );
    }

    return sections.join('\n\n---\n\n');
  }

  /**
   * Find notes related to a specific note
   */
  async findRelatedNotes(notePath: string, limit: number = 5): Promise<VaultSearchResult[]> {
    const note = await readNote(notePath);
    if (!note) return [];

    // Use note content as query
    const title = note.metadata.title || path.basename(notePath, '.md');
    const query = `${title} ${note.content.slice(0, 500)}`;

    const results = await this.searchNotes(query, { limit: limit + 1 });

    // Filter out the source note
    return results.filter((r) => r.path !== notePath).slice(0, limit);
  }

  /**
   * Get sync status
   */
  async getSyncStatus(): Promise<{
    totalNotes: number;
    indexedNotes: number;
    pendingNotes: number;
    lastSync?: number;
  }> {
    const allNotes = await getAllNotes();
    const indexedCount = this.indexedNotes.size;

    // Find last sync time
    let lastSync: number | undefined;
    for (const timestamp of this.indexedNotes.values()) {
      if (!lastSync || timestamp > lastSync) {
        lastSync = timestamp;
      }
    }

    return {
      totalNotes: allNotes.length,
      indexedNotes: indexedCount,
      pendingNotes: allNotes.length - indexedCount,
      lastSync,
    };
  }

  /**
   * Convert file path to document ID
   */
  private pathToId(notePath: string): string {
    return `vault:${notePath.replace(/[/\\]/g, '_').replace(/\.md$/, '')}`;
  }

  /**
   * Calculate importance score for a note
   */
  private calculateNoteImportance(metadata: NoteMetadata): number {
    let importance = 0.5; // Base importance

    // Boost importance based on type
    const type = metadata.type || '';
    if (type === 'self' || type === 'profile') {
      importance += 0.2;
    } else if (type === 'people') {
      importance += 0.15;
    } else if (type === 'concepts' || type === 'skills') {
      importance += 0.1;
    }

    // Boost for recent modifications
    if (metadata.last_modified) {
      const modDate = new Date(metadata.last_modified);
      const daysSinceModified = (Date.now() - modDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceModified < 7) {
        importance += 0.1;
      } else if (daysSinceModified < 30) {
        importance += 0.05;
      }
    }

    return Math.min(1, importance);
  }

  /**
   * Generate a relevant excerpt from content
   */
  private generateExcerpt(content: string, query: string): string {
    const maxLength = 300;
    const words = query.toLowerCase().split(/\s+/);

    // Find paragraphs
    const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 20);

    // Score each paragraph by query word matches
    let bestParagraph = paragraphs[0] || content;
    let bestScore = 0;

    for (const para of paragraphs) {
      const paraLower = para.toLowerCase();
      let score = 0;
      for (const word of words) {
        if (paraLower.includes(word)) {
          score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestParagraph = para;
      }
    }

    // Truncate if needed
    if (bestParagraph.length > maxLength) {
      // Try to find a sentence boundary
      const truncated = bestParagraph.slice(0, maxLength);
      const lastPeriod = truncated.lastIndexOf('.');
      if (lastPeriod > maxLength / 2) {
        return truncated.slice(0, lastPeriod + 1);
      }
      return truncated + '...';
    }

    return bestParagraph;
  }

  /**
   * Shutdown the sync manager
   */
  async shutdown(): Promise<void> {
    if (this.vectorStore) {
      await this.vectorStore.shutdown();
      this.vectorStore = null;
    }
    this.embeddingGenerator = null;
    this.isInitialized = false;
    this.indexedNotes.clear();

    logger.info('LanceSyncManager shutdown');
  }
}

// Singleton instance
let syncManager: LanceSyncManager | null = null;

/**
 * Get or create the sync manager instance
 */
export async function getLanceSyncManager(): Promise<LanceSyncManager> {
  if (!syncManager) {
    syncManager = new LanceSyncManager();
    await syncManager.initialize();
  }
  return syncManager;
}

/**
 * Shutdown the sync manager
 */
export async function shutdownLanceSyncManager(): Promise<void> {
  if (syncManager) {
    await syncManager.shutdown();
    syncManager = null;
  }
}

/**
 * Quick functions for common operations
 */

/**
 * Index a note (creates/updates in vector store)
 */
export async function indexNote(notePath: string): Promise<NoteIndexStatus> {
  const manager = await getLanceSyncManager();
  return manager.indexNote(notePath);
}

/**
 * Search vault notes semantically
 */
export async function searchNotes(
  query: string,
  options?: VaultSearchOptions
): Promise<VaultSearchResult[]> {
  const manager = await getLanceSyncManager();
  return manager.searchNotes(query, options);
}

/**
 * Reindex the entire vault
 */
export async function reindexAll(): Promise<{
  total: number;
  indexed: number;
  failed: number;
  errors: Record<string, string>;
}> {
  const manager = await getLanceSyncManager();
  return manager.reindexAll();
}

/**
 * Get combined knowledge about a topic
 */
export async function getKnowledgeAbout(topic: string, maxNotes?: number): Promise<string> {
  const manager = await getLanceSyncManager();
  return manager.getKnowledgeAbout(topic, maxNotes);
}
