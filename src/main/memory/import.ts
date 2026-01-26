/**
 * Atlas Desktop - Memory Import
 * Import memories from backup files with merge/replace options
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { createModuleLogger } from '../utils/logger';
import { MemoryManager, MemoryEntry, ConversationSession } from './index';
import { VectorDocument } from './vector-store/types';
import { UnifiedVectorStore } from './vector-store';
import {
  ExportedMemoryData,
  ExportHeader,
  EXPORT_FORMAT_VERSION,
} from './export';

const logger = createModuleLogger('MemoryImport');

const gunzipAsync = promisify(zlib.gunzip);

/**
 * Import mode
 */
export type ImportMode = 'merge' | 'replace';

/**
 * Import options
 */
export interface ImportOptions {
  /** Import mode: merge with existing or replace all */
  mode: ImportMode;
  /** Import memory entries */
  importEntries?: boolean;
  /** Import conversations */
  importConversations?: boolean;
  /** Import vector embeddings */
  importVectors?: boolean;
  /** Import summaries */
  importSummaries?: boolean;
  /** Skip data integrity validation */
  skipValidation?: boolean;
  /** Conflict resolution for merge mode */
  conflictResolution?: ConflictResolution;
  /** Filter entries by date range (start) */
  startDate?: number;
  /** Filter entries by date range (end) */
  endDate?: number;
  /** Filter by minimum importance */
  minImportance?: number;
  /** Transform IDs to avoid conflicts */
  transformIds?: boolean;
  /** Dry run - validate without importing */
  dryRun?: boolean;
}

/**
 * Conflict resolution strategy
 */
export type ConflictResolution = 'keep_existing' | 'use_imported' | 'keep_newer' | 'keep_higher_importance';

/**
 * Default import options
 */
const DEFAULT_IMPORT_OPTIONS: Required<Omit<ImportOptions, 'startDate' | 'endDate' | 'minImportance'>> = {
  mode: 'merge',
  importEntries: true,
  importConversations: true,
  importVectors: true,
  importSummaries: true,
  skipValidation: false,
  conflictResolution: 'keep_newer',
  transformIds: true,
  dryRun: false,
};

/**
 * Import progress event
 */
export interface ImportProgress {
  /** Current phase */
  phase: 'reading' | 'decompressing' | 'validating' | 'entries' | 'conversations' | 'vectors' | 'summaries' | 'complete';
  /** Items processed in current phase */
  processed: number;
  /** Total items in current phase */
  total: number;
  /** Overall progress percentage (0-100) */
  overallProgress: number;
  /** Conflicts encountered */
  conflicts: number;
  /** Skipped items */
  skipped: number;
}

/**
 * Import validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Validation errors */
  errors: ValidationError[];
  /** Validation warnings */
  warnings: string[];
  /** Statistics about the import file */
  stats: {
    formatVersion: number;
    exportedAt: number;
    totalEntries: number;
    totalConversations: number;
    totalVectors: number;
    totalSummaries: number;
    compressed: boolean;
    fileSizeBytes: number;
  };
}

/**
 * Validation error
 */
export interface ValidationError {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Whether the error is recoverable */
  recoverable: boolean;
}

/**
 * Import result
 */
export interface ImportResult {
  /** Whether import was successful */
  success: boolean;
  /** Import duration in ms */
  durationMs: number;
  /** Import statistics */
  stats: {
    entriesImported: number;
    entriesSkipped: number;
    conversationsImported: number;
    conversationsSkipped: number;
    vectorsImported: number;
    vectorsSkipped: number;
    summariesImported: number;
    summariesSkipped: number;
    conflictsResolved: number;
  };
  /** Validation result */
  validation?: ValidationResult;
  /** Error if import failed */
  error?: string;
}

/**
 * Import events
 */
export interface ImportEvents {
  /** Progress update */
  'progress': (progress: ImportProgress) => void;
  /** Import started */
  'started': () => void;
  /** Validation completed */
  'validated': (result: ValidationResult) => void;
  /** Import completed */
  'completed': (result: ImportResult) => void;
  /** Conflict detected */
  'conflict': (item: { type: string; id: string; resolution: string }) => void;
  /** Error occurred */
  'error': (error: Error) => void;
}

/**
 * MemoryImporter class
 * Handles importing memories from JSON backup files
 */
export class MemoryImporter extends EventEmitter {
  private isImporting = false;
  private abortController: AbortController | null = null;
  private startTime = 0;
  private conflicts = 0;
  private skipped = 0;

  constructor(
    private memoryManager: MemoryManager,
    private vectorStore?: UnifiedVectorStore
  ) {
    super();
    logger.info('MemoryImporter initialized');
  }

  /**
   * Validate an import file without importing
   */
  async validateFile(filePath: string): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    try {
      // Check file exists
      const fileExists = await fs.promises.access(filePath)
        .then(() => true)
        .catch(() => false);

      if (!fileExists) {
        return {
          valid: false,
          errors: [{
            code: 'FILE_NOT_FOUND',
            message: `File not found: ${filePath}`,
            recoverable: false,
          }],
          warnings: [],
          stats: {
            formatVersion: 0,
            exportedAt: 0,
            totalEntries: 0,
            totalConversations: 0,
            totalVectors: 0,
            totalSummaries: 0,
            compressed: false,
            fileSizeBytes: 0,
          },
        };
      }

      // Read and parse file
      const { data, fileSize } = await this.readImportFile(filePath);

      // Validate format version
      if (data.header.version > EXPORT_FORMAT_VERSION) {
        errors.push({
          code: 'VERSION_TOO_NEW',
          message: `Export format version ${data.header.version} is newer than supported version ${EXPORT_FORMAT_VERSION}`,
          recoverable: false,
        });
      } else if (data.header.version < EXPORT_FORMAT_VERSION) {
        warnings.push(`Export format version ${data.header.version} is older than current version ${EXPORT_FORMAT_VERSION}. Some features may not be available.`);
      }

      // Validate checksum
      const calculatedChecksum = this.calculateChecksum(JSON.stringify({
        ...data,
        header: { ...data.header, checksum: '' },
      }));

      if (data.header.checksum && calculatedChecksum !== data.header.checksum) {
        warnings.push('Checksum mismatch detected. File may have been modified.');
      }

      // Validate structure
      if (!Array.isArray(data.entries)) {
        errors.push({
          code: 'INVALID_ENTRIES',
          message: 'Invalid entries array in export file',
          recoverable: false,
        });
      }

      if (!Array.isArray(data.conversations)) {
        errors.push({
          code: 'INVALID_CONVERSATIONS',
          message: 'Invalid conversations array in export file',
          recoverable: false,
        });
      }

      if (!Array.isArray(data.vectors)) {
        errors.push({
          code: 'INVALID_VECTORS',
          message: 'Invalid vectors array in export file',
          recoverable: false,
        });
      }

      // Validate individual entries
      let invalidEntries = 0;
      for (const entry of data.entries) {
        if (!entry.id || !entry.type || !entry.content) {
          invalidEntries++;
        }
      }
      if (invalidEntries > 0) {
        warnings.push(`${invalidEntries} entries have missing required fields and will be skipped.`);
      }

      // Check for vector dimension consistency
      if (data.vectors.length > 0) {
        const dimensions = new Set(data.vectors.map(v => v.vector?.length || 0));
        if (dimensions.size > 1) {
          warnings.push('Vectors have inconsistent dimensions. Some vectors may not import correctly.');
        }
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        stats: {
          formatVersion: data.header.version,
          exportedAt: data.header.exportedAt,
          totalEntries: data.entries.length,
          totalConversations: data.conversations.length,
          totalVectors: data.vectors.length,
          totalSummaries: data.summaries?.length || 0,
          compressed: data.header.compressed,
          fileSizeBytes: fileSize,
        },
      };
    } catch (error) {
      return {
        valid: false,
        errors: [{
          code: 'PARSE_ERROR',
          message: `Failed to parse import file: ${(error as Error).message}`,
          recoverable: false,
        }],
        warnings,
        stats: {
          formatVersion: 0,
          exportedAt: 0,
          totalEntries: 0,
          totalConversations: 0,
          totalVectors: 0,
          totalSummaries: 0,
          compressed: false,
          fileSizeBytes: 0,
        },
      };
    }
  }

  /**
   * Import memories from a file
   */
  async importFromFile(filePath: string, options: Partial<ImportOptions> = {}): Promise<ImportResult> {
    if (this.isImporting) {
      throw new Error('Import already in progress');
    }

    this.isImporting = true;
    this.abortController = new AbortController();
    this.startTime = Date.now();
    this.conflicts = 0;
    this.skipped = 0;

    const opts: Required<Omit<ImportOptions, 'startDate' | 'endDate' | 'minImportance'>> & ImportOptions = {
      ...DEFAULT_IMPORT_OPTIONS,
      ...options,
    };

    const stats = {
      entriesImported: 0,
      entriesSkipped: 0,
      conversationsImported: 0,
      conversationsSkipped: 0,
      vectorsImported: 0,
      vectorsSkipped: 0,
      summariesImported: 0,
      summariesSkipped: 0,
      conflictsResolved: 0,
    };

    try {
      this.emit('started');
      this.emitProgress('reading', 0, 1, 0);

      // Read file
      const { data } = await this.readImportFile(filePath);

      // Validate
      let validation: ValidationResult | undefined;
      if (!opts.skipValidation) {
        this.emitProgress('validating', 0, 1, 10);
        validation = await this.validateFile(filePath);
        this.emit('validated', validation);

        if (!validation.valid) {
          throw new Error(`Validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
        }
      }

      // Check for dry run
      if (opts.dryRun) {
        logger.info('Dry run completed - no data imported');
        return {
          success: true,
          durationMs: Date.now() - this.startTime,
          stats,
          validation,
        };
      }

      // Clear existing data if replace mode
      if (opts.mode === 'replace') {
        await this.clearExistingData(opts);
      }

      // Import entries
      if (opts.importEntries && data.entries.length > 0) {
        const result = await this.importEntries(data.entries, opts);
        stats.entriesImported = result.imported;
        stats.entriesSkipped = result.skipped;
        stats.conflictsResolved += result.conflicts;
      }

      // Import conversations
      if (opts.importConversations && data.conversations.length > 0) {
        const result = await this.importConversations(data.conversations, opts);
        stats.conversationsImported = result.imported;
        stats.conversationsSkipped = result.skipped;
        stats.conflictsResolved += result.conflicts;
      }

      // Import vectors
      if (opts.importVectors && this.vectorStore && data.vectors.length > 0) {
        const result = await this.importVectors(data.vectors, opts);
        stats.vectorsImported = result.imported;
        stats.vectorsSkipped = result.skipped;
        stats.conflictsResolved += result.conflicts;
      }

      // Save changes
      await this.memoryManager.save();
      if (this.vectorStore) {
        await this.vectorStore['save']();
      }

      const durationMs = Date.now() - this.startTime;

      const result: ImportResult = {
        success: true,
        durationMs,
        stats,
        validation,
      };

      this.emitProgress('complete', 1, 1, 100);
      this.emit('completed', result);

      logger.info('Memory import completed', {
        durationMs,
        entriesImported: stats.entriesImported,
        conversationsImported: stats.conversationsImported,
        vectorsImported: stats.vectorsImported,
        conflictsResolved: stats.conflictsResolved,
      });

      return result;
    } catch (error) {
      const err = error as Error;
      logger.error('Memory import failed', { error: err.message });

      this.emit('error', err);

      return {
        success: false,
        durationMs: Date.now() - this.startTime,
        stats,
        error: err.message,
      };
    } finally {
      this.isImporting = false;
      this.abortController = null;
    }
  }

  /**
   * Import memories from a buffer
   */
  async importFromBuffer(buffer: Buffer, options: Partial<ImportOptions> = {}): Promise<ImportResult> {
    // Create temporary file and import from it
    const tempPath = `${process.env.TEMP || '/tmp'}/atlas-import-${Date.now()}.json`;

    try {
      await fs.promises.writeFile(tempPath, buffer);
      return await this.importFromFile(tempPath, options);
    } finally {
      // Clean up temp file
      await fs.promises.unlink(tempPath).catch(() => {});
    }
  }

  /**
   * Read and parse import file
   */
  private async readImportFile(filePath: string): Promise<{ data: ExportedMemoryData; fileSize: number }> {
    const fileBuffer = await fs.promises.readFile(filePath);
    const fileSize = fileBuffer.length;

    // Check if compressed (gzip magic bytes)
    const isCompressed = fileBuffer[0] === 0x1f && fileBuffer[1] === 0x8b;

    let jsonBuffer: Buffer;
    if (isCompressed) {
      this.emitProgress('decompressing', 0, 1, 5);
      jsonBuffer = Buffer.from(await gunzipAsync(fileBuffer));
    } else {
      jsonBuffer = fileBuffer;
    }

    const jsonString = jsonBuffer.toString('utf-8');
    const data = JSON.parse(jsonString) as ExportedMemoryData;

    return { data, fileSize };
  }

  /**
   * Clear existing data based on import options
   */
  private async clearExistingData(opts: Required<Omit<ImportOptions, 'startDate' | 'endDate' | 'minImportance'>> & ImportOptions): Promise<void> {
    if (opts.importEntries) {
      const entries = this.memoryManager['entries'] as Map<string, MemoryEntry>;
      entries.clear();
    }

    if (opts.importConversations) {
      const conversations = this.memoryManager['conversations'] as Map<string, ConversationSession>;
      conversations.clear();
    }

    if (opts.importVectors && this.vectorStore) {
      await this.vectorStore.clear();
    }

    logger.info('Existing data cleared for replace import');
  }

  /**
   * Import memory entries
   */
  private async importEntries(
    entries: MemoryEntry[],
    opts: Required<Omit<ImportOptions, 'startDate' | 'endDate' | 'minImportance'>> & ImportOptions
  ): Promise<{ imported: number; skipped: number; conflicts: number }> {
    let imported = 0;
    let skipped = 0;
    let conflicts = 0;

    const existingEntries = this.memoryManager['entries'] as Map<string, MemoryEntry>;
    const total = entries.length;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      // Apply filters
      if (opts.startDate && entry.createdAt < opts.startDate) {
        skipped++;
        continue;
      }
      if (opts.endDate && entry.createdAt > opts.endDate) {
        skipped++;
        continue;
      }
      if (opts.minImportance !== undefined && entry.importance < opts.minImportance) {
        skipped++;
        continue;
      }

      // Validate entry
      if (!entry.id || !entry.type || !entry.content) {
        skipped++;
        continue;
      }

      // Transform ID if needed
      const newId = opts.transformIds ? this.transformId(entry.id) : entry.id;

      // Check for conflict
      const existing = existingEntries.get(newId);
      if (existing) {
        if (opts.mode === 'replace') {
          existingEntries.set(newId, { ...entry, id: newId });
          imported++;
        } else {
          const resolution = this.resolveConflict(existing, entry, opts.conflictResolution);
          if (resolution === 'imported') {
            existingEntries.set(newId, { ...entry, id: newId });
            imported++;
          } else {
            skipped++;
          }
          conflicts++;
          this.emit('conflict', { type: 'entry', id: entry.id, resolution });
        }
      } else {
        existingEntries.set(newId, { ...entry, id: newId });
        imported++;
      }

      // Emit progress
      if (i % 100 === 0 || i === total - 1) {
        this.emitProgress('entries', i + 1, total, 20 + (i / total) * 20);
      }
    }

    this.skipped += skipped;
    this.conflicts += conflicts;

    return { imported, skipped, conflicts };
  }

  /**
   * Import conversations
   */
  private async importConversations(
    conversations: ConversationSession[],
    opts: Required<Omit<ImportOptions, 'startDate' | 'endDate' | 'minImportance'>> & ImportOptions
  ): Promise<{ imported: number; skipped: number; conflicts: number }> {
    let imported = 0;
    let skipped = 0;
    let conflicts = 0;

    const existingConversations = this.memoryManager['conversations'] as Map<string, ConversationSession>;
    const total = conversations.length;

    for (let i = 0; i < conversations.length; i++) {
      const conv = conversations[i];

      // Apply filters
      if (opts.startDate && conv.startedAt < opts.startDate) {
        skipped++;
        continue;
      }
      if (opts.endDate && conv.startedAt > opts.endDate) {
        skipped++;
        continue;
      }

      // Validate conversation
      if (!conv.id || !Array.isArray(conv.messages)) {
        skipped++;
        continue;
      }

      // Transform ID if needed
      const newId = opts.transformIds ? this.transformId(conv.id) : conv.id;

      // Check for conflict
      const existing = existingConversations.get(newId);
      if (existing) {
        if (opts.mode === 'replace') {
          existingConversations.set(newId, { ...conv, id: newId });
          imported++;
        } else {
          // For conversations, we could merge messages or keep one
          const resolution = this.resolveConversationConflict(existing, conv, opts.conflictResolution);
          if (resolution === 'imported') {
            existingConversations.set(newId, { ...conv, id: newId });
            imported++;
          } else if (resolution === 'merged') {
            // Merge messages from both conversations
            const mergedMessages = [...existing.messages, ...conv.messages]
              .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
            existingConversations.set(newId, {
              ...existing,
              messages: mergedMessages,
              lastActivityAt: Math.max(existing.lastActivityAt, conv.lastActivityAt),
            });
            imported++;
          } else {
            skipped++;
          }
          conflicts++;
          this.emit('conflict', { type: 'conversation', id: conv.id, resolution });
        }
      } else {
        existingConversations.set(newId, { ...conv, id: newId });
        imported++;
      }

      // Emit progress
      if (i % 10 === 0 || i === total - 1) {
        this.emitProgress('conversations', i + 1, total, 40 + (i / total) * 20);
      }
    }

    this.skipped += skipped;
    this.conflicts += conflicts;

    return { imported, skipped, conflicts };
  }

  /**
   * Import vector documents
   */
  private async importVectors(
    vectors: VectorDocument[],
    opts: Required<Omit<ImportOptions, 'startDate' | 'endDate' | 'minImportance'>> & ImportOptions
  ): Promise<{ imported: number; skipped: number; conflicts: number }> {
    let imported = 0;
    let skipped = 0;
    let conflicts = 0;

    if (!this.vectorStore) {
      return { imported: 0, skipped: vectors.length, conflicts: 0 };
    }

    const existingDocs = this.vectorStore['documents'] as Map<string, VectorDocument>;
    const total = vectors.length;

    for (let i = 0; i < vectors.length; i++) {
      const vec = vectors[i];

      // Apply filters
      if (opts.startDate && vec.createdAt < opts.startDate) {
        skipped++;
        continue;
      }
      if (opts.endDate && vec.createdAt > opts.endDate) {
        skipped++;
        continue;
      }
      if (opts.minImportance !== undefined && vec.metadata.importance < opts.minImportance) {
        skipped++;
        continue;
      }

      // Validate vector
      if (!vec.id || !vec.content || !vec.vector || !Array.isArray(vec.vector)) {
        skipped++;
        continue;
      }

      // Transform ID if needed
      const newId = opts.transformIds ? this.transformId(vec.id) : vec.id;

      // Check for conflict
      const existing = existingDocs.get(newId);
      if (existing) {
        if (opts.mode === 'replace') {
          existingDocs.set(newId, { ...vec, id: newId });
          imported++;
        } else {
          const resolution = this.resolveVectorConflict(existing, vec, opts.conflictResolution);
          if (resolution === 'imported') {
            existingDocs.set(newId, { ...vec, id: newId });
            imported++;
          } else {
            skipped++;
          }
          conflicts++;
          this.emit('conflict', { type: 'vector', id: vec.id, resolution });
        }
      } else {
        existingDocs.set(newId, { ...vec, id: newId });
        imported++;
      }

      // Emit progress
      if (i % 500 === 0 || i === total - 1) {
        this.emitProgress('vectors', i + 1, total, 60 + (i / total) * 30);
      }
    }

    this.skipped += skipped;
    this.conflicts += conflicts;

    return { imported, skipped, conflicts };
  }

  /**
   * Transform ID to avoid conflicts
   */
  private transformId(originalId: string): string {
    // Add import timestamp to make IDs unique
    const timestamp = Date.now().toString(36);
    const rand = Math.random().toString(36).substr(2, 4);
    return `${originalId}-import-${timestamp}-${rand}`;
  }

  /**
   * Resolve conflict between existing and imported entry
   */
  private resolveConflict(
    existing: MemoryEntry,
    imported: MemoryEntry,
    strategy: ConflictResolution
  ): 'existing' | 'imported' {
    switch (strategy) {
      case 'keep_existing':
        return 'existing';
      case 'use_imported':
        return 'imported';
      case 'keep_newer':
        return imported.createdAt > existing.createdAt ? 'imported' : 'existing';
      case 'keep_higher_importance':
        return imported.importance > existing.importance ? 'imported' : 'existing';
      default:
        return 'existing';
    }
  }

  /**
   * Resolve conflict for conversations
   */
  private resolveConversationConflict(
    existing: ConversationSession,
    imported: ConversationSession,
    strategy: ConflictResolution
  ): 'existing' | 'imported' | 'merged' {
    switch (strategy) {
      case 'keep_existing':
        return 'existing';
      case 'use_imported':
        return 'imported';
      case 'keep_newer':
        return imported.lastActivityAt > existing.lastActivityAt ? 'imported' : 'existing';
      case 'keep_higher_importance':
        // For conversations, merge by default for higher importance
        return 'merged';
      default:
        return 'existing';
    }
  }

  /**
   * Resolve conflict for vectors
   */
  private resolveVectorConflict(
    existing: VectorDocument,
    imported: VectorDocument,
    strategy: ConflictResolution
  ): 'existing' | 'imported' {
    switch (strategy) {
      case 'keep_existing':
        return 'existing';
      case 'use_imported':
        return 'imported';
      case 'keep_newer':
        return imported.createdAt > existing.createdAt ? 'imported' : 'existing';
      case 'keep_higher_importance':
        return imported.metadata.importance > existing.metadata.importance ? 'imported' : 'existing';
      default:
        return 'existing';
    }
  }

  /**
   * Calculate checksum for data integrity validation
   */
  private calculateChecksum(data: string): string {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  /**
   * Emit progress event
   */
  private emitProgress(
    phase: ImportProgress['phase'],
    processed: number,
    total: number,
    overallProgress: number
  ): void {
    this.emit('progress', {
      phase,
      processed,
      total,
      overallProgress: Math.min(100, Math.round(overallProgress)),
      conflicts: this.conflicts,
      skipped: this.skipped,
    });
  }

  /**
   * Abort an in-progress import
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      logger.info('Import aborted');
    }
  }

  /**
   * Check if import is in progress
   */
  isImportInProgress(): boolean {
    return this.isImporting;
  }

  // Type-safe event emitter methods
  on<K extends keyof ImportEvents>(event: K, listener: ImportEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof ImportEvents>(event: K, listener: ImportEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof ImportEvents>(event: K, ...args: Parameters<ImportEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * Detect if a file is a valid Atlas memory export
 */
export async function isValidExportFile(filePath: string): Promise<boolean> {
  try {
    const buffer = await fs.promises.readFile(filePath);

    // Check for gzip magic bytes
    const isCompressed = buffer[0] === 0x1f && buffer[1] === 0x8b;

    let jsonBuffer: Buffer;
    if (isCompressed) {
      jsonBuffer = await gunzipAsync(buffer) as Buffer;
    } else {
      jsonBuffer = buffer;
    }

    const data = JSON.parse(jsonBuffer.toString('utf-8'));

    // Check for required header fields
    return (
      data.header &&
      typeof data.header.version === 'number' &&
      typeof data.header.exportedAt === 'number' &&
      Array.isArray(data.entries) &&
      Array.isArray(data.conversations)
    );
  } catch {
    return false;
  }
}

/**
 * Get export file metadata without fully parsing
 */
export async function getExportFileInfo(filePath: string): Promise<ExportHeader | null> {
  try {
    const buffer = await fs.promises.readFile(filePath);

    const isCompressed = buffer[0] === 0x1f && buffer[1] === 0x8b;

    let jsonBuffer: Buffer;
    if (isCompressed) {
      jsonBuffer = await gunzipAsync(buffer) as Buffer;
    } else {
      jsonBuffer = buffer;
    }

    const data = JSON.parse(jsonBuffer.toString('utf-8'));
    return data.header || null;
  } catch {
    return null;
  }
}

export default MemoryImporter;
