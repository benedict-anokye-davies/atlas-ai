/**
 * Atlas Desktop - Memory Export
 * Export memories to JSON format with compression support
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { createModuleLogger } from '../utils/logger';
import { MemoryManager, MemoryEntry, ConversationSession } from './index';
import { VectorDocument } from './vector-store/types';
import { UnifiedVectorStore } from './vector-store';
import { ConversationSummary } from './types';

const logger = createModuleLogger('MemoryExport');

const gzipAsync = promisify(zlib.gzip);

/**
 * Export file format version
 */
export const EXPORT_FORMAT_VERSION = 1;

/**
 * Export file header
 */
export interface ExportHeader {
  /** Format version for compatibility checking */
  version: number;
  /** Export timestamp */
  exportedAt: number;
  /** Atlas version that created the export */
  atlasVersion: string;
  /** Checksum for integrity validation */
  checksum: string;
  /** Whether the data is compressed */
  compressed: boolean;
  /** Total number of entries */
  totalEntries: number;
  /** Total number of conversations */
  totalConversations: number;
  /** Total number of vectors */
  totalVectors: number;
  /** Total number of summaries */
  totalSummaries: number;
}

/**
 * Exported memory data structure
 */
export interface ExportedMemoryData {
  /** Export header with metadata */
  header: ExportHeader;
  /** Memory entries (facts, preferences, context) */
  entries: MemoryEntry[];
  /** Conversation sessions */
  conversations: ConversationSession[];
  /** Vector documents with embeddings */
  vectors: VectorDocument[];
  /** Conversation summaries */
  summaries: ConversationSummary[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Export options
 */
export interface ExportOptions {
  /** Include memory entries */
  includeEntries?: boolean;
  /** Include conversations */
  includeConversations?: boolean;
  /** Include vector embeddings */
  includeVectors?: boolean;
  /** Include summaries */
  includeSummaries?: boolean;
  /** Enable compression */
  compress?: boolean;
  /** Filter by date range (start) */
  startDate?: number;
  /** Filter by date range (end) */
  endDate?: number;
  /** Filter by memory types */
  memoryTypes?: Array<'conversation' | 'fact' | 'preference' | 'context'>;
  /** Filter by minimum importance */
  minImportance?: number;
  /** Additional metadata to include */
  metadata?: Record<string, unknown>;
}

/**
 * Default export options
 */
const DEFAULT_EXPORT_OPTIONS: Required<Omit<ExportOptions, 'startDate' | 'endDate' | 'memoryTypes' | 'minImportance' | 'metadata'>> = {
  includeEntries: true,
  includeConversations: true,
  includeVectors: true,
  includeSummaries: true,
  compress: true,
};

/**
 * Export progress event
 */
export interface ExportProgress {
  /** Current phase */
  phase: 'preparing' | 'entries' | 'conversations' | 'vectors' | 'summaries' | 'compressing' | 'writing' | 'complete';
  /** Items processed in current phase */
  processed: number;
  /** Total items in current phase */
  total: number;
  /** Overall progress percentage (0-100) */
  overallProgress: number;
  /** Estimated time remaining in ms */
  estimatedTimeRemaining?: number;
}

/**
 * Export result
 */
export interface ExportResult {
  /** Whether export was successful */
  success: boolean;
  /** Output file path */
  filePath?: string;
  /** Total bytes written */
  bytesWritten?: number;
  /** Compression ratio achieved */
  compressionRatio?: number;
  /** Export duration in ms */
  durationMs: number;
  /** Export statistics */
  stats: {
    entries: number;
    conversations: number;
    vectors: number;
    summaries: number;
  };
  /** Error if export failed */
  error?: string;
}

/**
 * Export events
 */
export interface ExportEvents {
  /** Progress update */
  'progress': (progress: ExportProgress) => void;
  /** Export started */
  'started': () => void;
  /** Export completed */
  'completed': (result: ExportResult) => void;
  /** Error occurred */
  'error': (error: Error) => void;
}

/**
 * MemoryExporter class
 * Handles exporting memories to JSON format with optional compression
 */
export class MemoryExporter extends EventEmitter {
  private isExporting = false;
  private abortController: AbortController | null = null;
  private startTime = 0;

  constructor(
    private memoryManager: MemoryManager,
    private vectorStore?: UnifiedVectorStore
  ) {
    super();
    logger.info('MemoryExporter initialized');
  }

  /**
   * Export memories to a file
   */
  async exportToFile(filePath: string, options: ExportOptions = {}): Promise<ExportResult> {
    if (this.isExporting) {
      throw new Error('Export already in progress');
    }

    this.isExporting = true;
    this.abortController = new AbortController();
    this.startTime = Date.now();

    const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options };

    try {
      this.emit('started');
      this.emitProgress('preparing', 0, 1, 0);

      // Collect all data
      const exportData = await this.collectExportData(opts);

      // Calculate checksum
      const jsonData = JSON.stringify(exportData);
      exportData.header.checksum = this.calculateChecksum(jsonData);

      // Serialize to JSON
      let outputData: Buffer;
      let originalSize: number;
      let compressedSize: number;

      if (opts.compress) {
        this.emitProgress('compressing', 0, 1, 85);

        const jsonBuffer = Buffer.from(jsonData, 'utf-8');
        originalSize = jsonBuffer.length;

        outputData = await gzipAsync(jsonBuffer) as Buffer;
        compressedSize = outputData.length;

        // Update header with compression info
        exportData.header.compressed = true;
      } else {
        outputData = Buffer.from(jsonData, 'utf-8');
        originalSize = outputData.length;
        compressedSize = originalSize;
        exportData.header.compressed = false;
      }

      // Ensure output directory exists
      const outputDir = path.dirname(filePath);
      await fs.promises.mkdir(outputDir, { recursive: true });

      // Write to file
      this.emitProgress('writing', 0, 1, 95);

      // Add appropriate extension
      const finalPath = opts.compress && !filePath.endsWith('.gz')
        ? `${filePath}.gz`
        : filePath;

      await fs.promises.writeFile(finalPath, outputData);

      const durationMs = Date.now() - this.startTime;

      const result: ExportResult = {
        success: true,
        filePath: finalPath,
        bytesWritten: compressedSize,
        compressionRatio: opts.compress ? originalSize / compressedSize : 1,
        durationMs,
        stats: {
          entries: exportData.entries.length,
          conversations: exportData.conversations.length,
          vectors: exportData.vectors.length,
          summaries: exportData.summaries.length,
        },
      };

      this.emitProgress('complete', 1, 1, 100);
      this.emit('completed', result);

      logger.info('Memory export completed', {
        filePath: finalPath,
        bytesWritten: compressedSize,
        compressionRatio: result.compressionRatio?.toFixed(2),
        durationMs,
      });

      return result;
    } catch (error) {
      const err = error as Error;
      logger.error('Memory export failed', { error: err.message });

      this.emit('error', err);

      return {
        success: false,
        durationMs: Date.now() - this.startTime,
        stats: { entries: 0, conversations: 0, vectors: 0, summaries: 0 },
        error: err.message,
      };
    } finally {
      this.isExporting = false;
      this.abortController = null;
    }
  }

  /**
   * Export memories to a buffer (in-memory export)
   */
  async exportToBuffer(options: ExportOptions = {}): Promise<Buffer> {
    const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options };

    const exportData = await this.collectExportData(opts);

    const jsonData = JSON.stringify(exportData);
    exportData.header.checksum = this.calculateChecksum(jsonData);

    const jsonBuffer = Buffer.from(JSON.stringify(exportData), 'utf-8');

    if (opts.compress) {
      return await gzipAsync(jsonBuffer) as Buffer;
    }

    return jsonBuffer;
  }

  /**
   * Collect all data for export
   */
  private async collectExportData(opts: Required<Omit<ExportOptions, 'startDate' | 'endDate' | 'memoryTypes' | 'minImportance' | 'metadata'>> & ExportOptions): Promise<ExportedMemoryData> {
    const entries: MemoryEntry[] = [];
    const conversations: ConversationSession[] = [];
    const vectors: VectorDocument[] = [];
    const summaries: ConversationSummary[] = [];

    let processedPhases = 0;
    const totalPhases = 4;

    // Collect memory entries
    if (opts.includeEntries) {
      this.emitProgress('entries', 0, 1, (processedPhases / totalPhases) * 80);

      const allEntries = this.memoryManager['entries'] as Map<string, MemoryEntry>;
      const entriesArray = Array.from(allEntries.values());

      for (const entry of entriesArray) {
        // Apply filters
        if (opts.startDate && entry.createdAt < opts.startDate) continue;
        if (opts.endDate && entry.createdAt > opts.endDate) continue;
        if (opts.memoryTypes && !opts.memoryTypes.includes(entry.type)) continue;
        if (opts.minImportance !== undefined && entry.importance < opts.minImportance) continue;

        entries.push(entry);
      }

      this.emitProgress('entries', entries.length, entries.length, (processedPhases / totalPhases) * 80 + 20);
    }
    processedPhases++;

    // Collect conversations
    if (opts.includeConversations) {
      this.emitProgress('conversations', 0, 1, (processedPhases / totalPhases) * 80);

      const allConversations = this.memoryManager['conversations'] as Map<string, ConversationSession>;
      const conversationsArray = Array.from(allConversations.values());

      for (const conv of conversationsArray) {
        // Apply date filters
        if (opts.startDate && conv.startedAt < opts.startDate) continue;
        if (opts.endDate && conv.startedAt > opts.endDate) continue;

        conversations.push(conv);
      }

      this.emitProgress('conversations', conversations.length, conversations.length, (processedPhases / totalPhases) * 80 + 20);
    }
    processedPhases++;

    // Collect vector documents
    if (opts.includeVectors && this.vectorStore) {
      this.emitProgress('vectors', 0, 1, (processedPhases / totalPhases) * 80);

      const allVectors = this.vectorStore['documents'] as Map<string, VectorDocument>;
      const vectorsArray = Array.from(allVectors.values());
      let processed = 0;
      const total = vectorsArray.length;

      for (const vec of vectorsArray) {
        // Apply filters
        if (opts.startDate && vec.createdAt < opts.startDate) continue;
        if (opts.endDate && vec.createdAt > opts.endDate) continue;
        if (opts.minImportance !== undefined && vec.metadata.importance < opts.minImportance) continue;

        vectors.push(vec);
        processed++;

        // Emit progress for large datasets
        if (processed % 1000 === 0) {
          this.emitProgress('vectors', processed, total, (processedPhases / totalPhases) * 80 + (processed / total) * 20);
        }
      }

      this.emitProgress('vectors', vectors.length, vectors.length, (processedPhases / totalPhases) * 80 + 20);
    }
    processedPhases++;

    // Collect summaries (if available)
    if (opts.includeSummaries) {
      this.emitProgress('summaries', 0, 1, (processedPhases / totalPhases) * 80);
      // Summaries would be collected from summarizer if available
      // For now, this is a placeholder
      this.emitProgress('summaries', summaries.length, summaries.length, (processedPhases / totalPhases) * 80 + 20);
    }

    // Build export data
    const header: ExportHeader = {
      version: EXPORT_FORMAT_VERSION,
      exportedAt: Date.now(),
      atlasVersion: process.env.npm_package_version || '1.0.0',
      checksum: '', // Will be calculated after serialization
      compressed: opts.compress,
      totalEntries: entries.length,
      totalConversations: conversations.length,
      totalVectors: vectors.length,
      totalSummaries: summaries.length,
    };

    return {
      header,
      entries,
      conversations,
      vectors,
      summaries,
      metadata: opts.metadata,
    };
  }

  /**
   * Calculate checksum for data integrity
   */
  private calculateChecksum(data: string): string {
    // Simple checksum using string hash
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  /**
   * Emit progress event
   */
  private emitProgress(
    phase: ExportProgress['phase'],
    processed: number,
    total: number,
    overallProgress: number
  ): void {
    const elapsed = Date.now() - this.startTime;
    const estimatedTotal = overallProgress > 0 ? (elapsed / overallProgress) * 100 : undefined;
    const estimatedRemaining = estimatedTotal ? estimatedTotal - elapsed : undefined;

    this.emit('progress', {
      phase,
      processed,
      total,
      overallProgress: Math.min(100, Math.round(overallProgress)),
      estimatedTimeRemaining: estimatedRemaining ? Math.round(estimatedRemaining) : undefined,
    });
  }

  /**
   * Abort an in-progress export
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      logger.info('Export aborted');
    }
  }

  /**
   * Check if export is in progress
   */
  isExportInProgress(): boolean {
    return this.isExporting;
  }

  // Type-safe event emitter methods
  on<K extends keyof ExportEvents>(event: K, listener: ExportEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof ExportEvents>(event: K, listener: ExportEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof ExportEvents>(event: K, ...args: Parameters<ExportEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * Generate a default export filename with timestamp
 */
export function generateExportFilename(prefix: string = 'atlas-memory-export'): string {
  const date = new Date();
  const timestamp = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${prefix}-${timestamp}.json`;
}

/**
 * Validate export file path
 */
export function validateExportPath(filePath: string): { valid: boolean; error?: string } {
  // Check for valid extension
  const validExtensions = ['.json', '.json.gz'];
  const hasValidExt = validExtensions.some(ext => filePath.endsWith(ext));

  if (!hasValidExt && !filePath.includes('.')) {
    // No extension provided, will be added automatically
    return { valid: true };
  }

  if (!hasValidExt) {
    return {
      valid: false,
      error: `Invalid file extension. Expected: ${validExtensions.join(' or ')}`
    };
  }

  return { valid: true };
}

export default MemoryExporter;
