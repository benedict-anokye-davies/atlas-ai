/**
 * Atlas Desktop - Notes Storage
 * Persistent storage layer for voice-first note taking system
 *
 * Stores notes as markdown files with YAML frontmatter for metadata.
 * Supports tagging, categorization, and full-text search.
 *
 * @module notes/storage
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('NotesStorage');

// ============================================================================
// Types
// ============================================================================

/**
 * Note category for organization
 */
export type NoteCategory =
  | 'general'
  | 'idea'
  | 'task'
  | 'reminder'
  | 'meeting'
  | 'journal'
  | 'reference'
  | 'quick';

/**
 * Note priority level
 */
export type NotePriority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * Note metadata stored in YAML frontmatter
 */
export interface NoteMetadata {
  /** Unique note identifier */
  id: string;
  /** Note title (derived from first line or generated) */
  title: string;
  /** Category for organization */
  category: NoteCategory;
  /** Tags for filtering and search */
  tags: string[];
  /** Priority level */
  priority: NotePriority;
  /** Creation timestamp (ISO 8601) */
  createdAt: string;
  /** Last modified timestamp (ISO 8601) */
  updatedAt: string;
  /** Source of the note (voice, text, import) */
  source: 'voice' | 'text' | 'import';
  /** Whether this is a quick capture note */
  isQuickCapture: boolean;
  /** Whether the note is pinned */
  isPinned: boolean;
  /** Whether the note is archived */
  isArchived: boolean;
  /** Associated memory entry ID (for sync with memory system) */
  memoryId?: string;
  /** Word count */
  wordCount: number;
  /** Reading time estimate in minutes */
  readingTime: number;
}

/**
 * Complete note with content and metadata
 */
export interface Note {
  /** Note metadata */
  metadata: NoteMetadata;
  /** Note content in markdown format */
  content: string;
  /** Raw file path */
  filePath: string;
}

/**
 * Note creation input
 */
export interface CreateNoteInput {
  /** Note content (markdown) */
  content: string;
  /** Optional title (auto-derived if not provided) */
  title?: string;
  /** Category (defaults to 'general') */
  category?: NoteCategory;
  /** Tags for the note */
  tags?: string[];
  /** Priority level (defaults to 'medium') */
  priority?: NotePriority;
  /** Source of note creation */
  source?: 'voice' | 'text' | 'import';
  /** Quick capture mode flag */
  isQuickCapture?: boolean;
}

/**
 * Note update input
 */
export interface UpdateNoteInput {
  /** Updated content */
  content?: string;
  /** Updated title */
  title?: string;
  /** Updated category */
  category?: NoteCategory;
  /** Updated tags (replaces existing) */
  tags?: string[];
  /** Updated priority */
  priority?: NotePriority;
  /** Update pinned status */
  isPinned?: boolean;
  /** Update archived status */
  isArchived?: boolean;
}

/**
 * Search query for notes
 */
export interface NoteSearchQuery {
  /** Text to search in content and title */
  text?: string;
  /** Filter by category */
  category?: NoteCategory;
  /** Filter by tags (any match) */
  tags?: string[];
  /** Filter by priority */
  priority?: NotePriority;
  /** Include archived notes */
  includeArchived?: boolean;
  /** Only pinned notes */
  pinnedOnly?: boolean;
  /** Created after date */
  createdAfter?: Date;
  /** Created before date */
  createdBefore?: Date;
  /** Maximum number of results */
  limit?: number;
  /** Sort field */
  sortBy?: 'createdAt' | 'updatedAt' | 'title' | 'priority';
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Storage configuration
 */
export interface NotesStorageConfig {
  /** Base directory for notes storage */
  storageDir: string;
  /** Auto-save interval in milliseconds */
  autoSaveInterval: number;
  /** Maximum notes to keep in memory cache */
  maxCacheSize: number;
  /** Enable file watching for external changes */
  enableFileWatch: boolean;
}

/**
 * Default storage configuration
 */
const DEFAULT_STORAGE_CONFIG: NotesStorageConfig = {
  storageDir: path.join(homedir(), '.atlas', 'notes'),
  autoSaveInterval: 5000,
  maxCacheSize: 100,
  enableFileWatch: true,
};

// ============================================================================
// Storage Implementation
// ============================================================================

/**
 * Notes Storage Manager
 *
 * Handles persistent storage of notes as markdown files with YAML frontmatter.
 * Provides CRUD operations, search, and file system management.
 */
export class NotesStorage {
  private config: NotesStorageConfig;
  private cache: Map<string, Note> = new Map();
  private indexDirty = true;
  private watcher: fs.FSWatcher | null = null;

  constructor(config?: Partial<NotesStorageConfig>) {
    this.config = { ...DEFAULT_STORAGE_CONFIG, ...config };
    logger.info('NotesStorage initialized', { storageDir: this.config.storageDir });
  }

  /**
   * Initialize storage (create directories, load index)
   */
  async initialize(): Promise<void> {
    try {
      // Ensure storage directory exists
      await this.ensureStorageDir();

      // Load existing notes into cache
      await this.loadIndex();

      // Set up file watcher if enabled
      if (this.config.enableFileWatch) {
        this.startFileWatch();
      }

      logger.info('NotesStorage initialized successfully', {
        notesCount: this.cache.size,
      });
    } catch (error) {
      logger.error('Failed to initialize NotesStorage', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Ensure storage directory structure exists
   */
  private async ensureStorageDir(): Promise<void> {
    const dirs = [
      this.config.storageDir,
      path.join(this.config.storageDir, 'general'),
      path.join(this.config.storageDir, 'ideas'),
      path.join(this.config.storageDir, 'tasks'),
      path.join(this.config.storageDir, 'reminders'),
      path.join(this.config.storageDir, 'meetings'),
      path.join(this.config.storageDir, 'journal'),
      path.join(this.config.storageDir, 'reference'),
      path.join(this.config.storageDir, 'quick'),
      path.join(this.config.storageDir, 'archive'),
    ];

    for (const dir of dirs) {
      try {
        await fs.promises.mkdir(dir, { recursive: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
      }
    }
  }

  /**
   * Load all notes into the index cache
   */
  private async loadIndex(): Promise<void> {
    this.cache.clear();
    const categories: NoteCategory[] = [
      'general',
      'idea',
      'task',
      'reminder',
      'meeting',
      'journal',
      'reference',
      'quick',
    ];

    for (const category of categories) {
      const categoryDir = this.getCategoryDir(category);
      try {
        const files = await fs.promises.readdir(categoryDir);
        for (const file of files) {
          if (file.endsWith('.md')) {
            const filePath = path.join(categoryDir, file);
            try {
              const note = await this.loadNoteFromFile(filePath);
              if (note) {
                this.cache.set(note.metadata.id, note);
              }
            } catch (error) {
              logger.warn('Failed to load note file', {
                file: filePath,
                error: (error as Error).message,
              });
            }
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn('Failed to read category directory', {
            category,
            error: (error as Error).message,
          });
        }
      }
    }

    // Also load archived notes
    const archiveDir = path.join(this.config.storageDir, 'archive');
    try {
      const files = await fs.promises.readdir(archiveDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const filePath = path.join(archiveDir, file);
          try {
            const note = await this.loadNoteFromFile(filePath);
            if (note) {
              this.cache.set(note.metadata.id, note);
            }
          } catch (error) {
            logger.warn('Failed to load archived note', {
              file: filePath,
              error: (error as Error).message,
            });
          }
        }
      }
    } catch (error) {
      // Archive directory might not exist yet
    }

    this.indexDirty = false;
    logger.debug('Notes index loaded', { totalNotes: this.cache.size });
  }

  /**
   * Get the directory path for a category
   */
  private getCategoryDir(category: NoteCategory): string {
    const categoryDirMap: Record<NoteCategory, string> = {
      general: 'general',
      idea: 'ideas',
      task: 'tasks',
      reminder: 'reminders',
      meeting: 'meetings',
      journal: 'journal',
      reference: 'reference',
      quick: 'quick',
    };
    return path.join(this.config.storageDir, categoryDirMap[category] || 'general');
  }

  /**
   * Generate a unique note ID
   */
  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `note-${timestamp}-${random}`;
  }

  /**
   * Generate a filename from title
   */
  private generateFilename(title: string, id: string): string {
    // Sanitize title for filename
    const sanitized = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);
    return `${sanitized || 'untitled'}-${id.substring(5, 13)}.md`;
  }

  /**
   * Extract title from content (first line or first sentence)
   */
  private extractTitle(content: string): string {
    const lines = content.trim().split('\n');
    const firstLine = lines[0] || '';

    // Remove markdown heading prefix
    const title = firstLine.replace(/^#+\s*/, '').trim();

    // If too long, truncate at first sentence or 60 chars
    if (title.length > 60) {
      const sentenceEnd = title.search(/[.!?]/);
      if (sentenceEnd > 0 && sentenceEnd < 60) {
        return title.substring(0, sentenceEnd + 1);
      }
      return title.substring(0, 57) + '...';
    }

    return title || 'Untitled Note';
  }

  /**
   * Calculate word count
   */
  private calculateWordCount(content: string): number {
    return content
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;
  }

  /**
   * Calculate reading time in minutes (assuming 200 wpm)
   */
  private calculateReadingTime(wordCount: number): number {
    return Math.max(1, Math.ceil(wordCount / 200));
  }

  /**
   * Parse YAML frontmatter from markdown file
   */
  private parseNoteFile(content: string): { metadata: Partial<NoteMetadata>; content: string } {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return { metadata: {}, content: content.trim() };
    }

    const yamlContent = match[1];
    const markdownContent = match[2].trim();

    // Simple YAML parser for frontmatter
    const metadata: Partial<NoteMetadata> = {};
    const lines = yamlContent.split('\n');

    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const key = line.substring(0, colonIndex).trim();
      let value = line.substring(colonIndex + 1).trim();

      // Handle arrays (tags)
      if (value.startsWith('[') && value.endsWith(']')) {
        value = value.slice(1, -1);
        (metadata as Record<string, unknown>)[key] = value.split(',').map((v) => v.trim().replace(/['"]/g, ''));
      }
      // Handle booleans
      else if (value === 'true' || value === 'false') {
        (metadata as Record<string, unknown>)[key] = value === 'true';
      }
      // Handle numbers
      else if (!isNaN(Number(value)) && value !== '') {
        (metadata as Record<string, unknown>)[key] = Number(value);
      }
      // Handle strings (remove quotes if present)
      else {
        (metadata as Record<string, unknown>)[key] = value.replace(/^['"]|['"]$/g, '');
      }
    }

    return { metadata, content: markdownContent };
  }

  /**
   * Generate YAML frontmatter from metadata
   */
  private generateFrontmatter(metadata: NoteMetadata): string {
    const lines = [
      '---',
      `id: "${metadata.id}"`,
      `title: "${metadata.title.replace(/"/g, '\\"')}"`,
      `category: "${metadata.category}"`,
      `tags: [${metadata.tags.map((t) => `"${t}"`).join(', ')}]`,
      `priority: "${metadata.priority}"`,
      `createdAt: "${metadata.createdAt}"`,
      `updatedAt: "${metadata.updatedAt}"`,
      `source: "${metadata.source}"`,
      `isQuickCapture: ${metadata.isQuickCapture}`,
      `isPinned: ${metadata.isPinned}`,
      `isArchived: ${metadata.isArchived}`,
      metadata.memoryId ? `memoryId: "${metadata.memoryId}"` : null,
      `wordCount: ${metadata.wordCount}`,
      `readingTime: ${metadata.readingTime}`,
      '---',
    ].filter((line) => line !== null);

    return lines.join('\n');
  }

  /**
   * Load a note from a file
   */
  private async loadNoteFromFile(filePath: string): Promise<Note | null> {
    try {
      const rawContent = await fs.promises.readFile(filePath, 'utf-8');
      const { metadata, content } = this.parseNoteFile(rawContent);

      if (!metadata.id) {
        logger.warn('Note file missing ID', { filePath });
        return null;
      }

      // Construct full metadata with defaults
      const fullMetadata: NoteMetadata = {
        id: metadata.id,
        title: metadata.title || this.extractTitle(content),
        category: (metadata.category as NoteCategory) || 'general',
        tags: (metadata.tags as string[]) || [],
        priority: (metadata.priority as NotePriority) || 'medium',
        createdAt: metadata.createdAt || new Date().toISOString(),
        updatedAt: metadata.updatedAt || new Date().toISOString(),
        source: (metadata.source as 'voice' | 'text' | 'import') || 'text',
        isQuickCapture: metadata.isQuickCapture || false,
        isPinned: metadata.isPinned || false,
        isArchived: metadata.isArchived || false,
        memoryId: metadata.memoryId,
        wordCount: metadata.wordCount || this.calculateWordCount(content),
        readingTime: metadata.readingTime || this.calculateReadingTime(this.calculateWordCount(content)),
      };

      return {
        metadata: fullMetadata,
        content,
        filePath,
      };
    } catch (error) {
      logger.error('Failed to load note file', {
        filePath,
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Save a note to file
   */
  private async saveNoteToFile(note: Note): Promise<void> {
    const frontmatter = this.generateFrontmatter(note.metadata);
    const fileContent = `${frontmatter}\n\n${note.content}`;

    // Ensure directory exists
    const dir = path.dirname(note.filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    await fs.promises.writeFile(note.filePath, fileContent, 'utf-8');
    logger.debug('Note saved to file', { id: note.metadata.id, path: note.filePath });
  }

  /**
   * Start file system watcher
   */
  private startFileWatch(): void {
    if (this.watcher) {
      return;
    }

    try {
      this.watcher = fs.watch(this.config.storageDir, { recursive: true }, (eventType, filename) => {
        if (filename && filename.endsWith('.md')) {
          logger.debug('File change detected', { eventType, filename });
          this.indexDirty = true;
        }
      });

      this.watcher.on('error', (error) => {
        logger.warn('File watcher error', { error: (error as Error).message });
      });
    } catch (error) {
      logger.warn('Failed to start file watcher', { error: (error as Error).message });
    }
  }

  /**
   * Stop file system watcher
   */
  private stopFileWatch(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Create a new note
   */
  async create(input: CreateNoteInput): Promise<Note> {
    const id = this.generateId();
    const now = new Date().toISOString();
    const title = input.title || this.extractTitle(input.content);
    const category = input.category || 'general';
    const wordCount = this.calculateWordCount(input.content);

    const metadata: NoteMetadata = {
      id,
      title,
      category,
      tags: input.tags || [],
      priority: input.priority || 'medium',
      createdAt: now,
      updatedAt: now,
      source: input.source || 'text',
      isQuickCapture: input.isQuickCapture || false,
      isPinned: false,
      isArchived: false,
      wordCount,
      readingTime: this.calculateReadingTime(wordCount),
    };

    const filename = this.generateFilename(title, id);
    const filePath = path.join(this.getCategoryDir(category), filename);

    const note: Note = {
      metadata,
      content: input.content,
      filePath,
    };

    // Save to file
    await this.saveNoteToFile(note);

    // Add to cache
    this.cache.set(id, note);

    logger.info('Note created', {
      id,
      title,
      category,
      source: metadata.source,
    });

    return note;
  }

  /**
   * Get a note by ID
   */
  async get(id: string): Promise<Note | null> {
    // Check cache first
    const cached = this.cache.get(id);
    if (cached) {
      return cached;
    }

    // If index is dirty, reload
    if (this.indexDirty) {
      await this.loadIndex();
    }

    return this.cache.get(id) || null;
  }

  /**
   * Update an existing note
   */
  async update(id: string, input: UpdateNoteInput): Promise<Note | null> {
    const existing = await this.get(id);
    if (!existing) {
      logger.warn('Note not found for update', { id });
      return null;
    }

    const now = new Date().toISOString();
    const updatedContent = input.content !== undefined ? input.content : existing.content;
    const wordCount = this.calculateWordCount(updatedContent);

    // Check if category changed (need to move file)
    const oldCategory = existing.metadata.category;
    const newCategory = input.category || oldCategory;
    const categoryChanged = newCategory !== oldCategory;

    // Check if archival status changed
    const wasArchived = existing.metadata.isArchived;
    const isArchived = input.isArchived !== undefined ? input.isArchived : wasArchived;
    const archiveChanged = isArchived !== wasArchived;

    // Update metadata
    const updatedMetadata: NoteMetadata = {
      ...existing.metadata,
      title: input.title !== undefined ? input.title : existing.metadata.title,
      category: newCategory,
      tags: input.tags !== undefined ? input.tags : existing.metadata.tags,
      priority: input.priority !== undefined ? input.priority : existing.metadata.priority,
      isPinned: input.isPinned !== undefined ? input.isPinned : existing.metadata.isPinned,
      isArchived,
      updatedAt: now,
      wordCount,
      readingTime: this.calculateReadingTime(wordCount),
    };

    // Determine new file path
    let newFilePath = existing.filePath;
    if (categoryChanged || archiveChanged) {
      const filename = path.basename(existing.filePath);
      if (isArchived) {
        newFilePath = path.join(this.config.storageDir, 'archive', filename);
      } else {
        newFilePath = path.join(this.getCategoryDir(newCategory), filename);
      }
    }

    const updatedNote: Note = {
      metadata: updatedMetadata,
      content: updatedContent,
      filePath: newFilePath,
    };

    // If path changed, delete old file and save to new location
    if (newFilePath !== existing.filePath) {
      try {
        await fs.promises.unlink(existing.filePath);
      } catch (error) {
        logger.warn('Failed to delete old note file', { path: existing.filePath });
      }
    }

    // Save to file
    await this.saveNoteToFile(updatedNote);

    // Update cache
    this.cache.set(id, updatedNote);

    logger.info('Note updated', { id, changes: Object.keys(input) });

    return updatedNote;
  }

  /**
   * Delete a note
   */
  async delete(id: string): Promise<boolean> {
    const note = await this.get(id);
    if (!note) {
      logger.warn('Note not found for deletion', { id });
      return false;
    }

    try {
      await fs.promises.unlink(note.filePath);
      this.cache.delete(id);
      logger.info('Note deleted', { id, title: note.metadata.title });
      return true;
    } catch (error) {
      logger.error('Failed to delete note', { id, error: (error as Error).message });
      return false;
    }
  }

  /**
   * Search notes
   */
  async search(query: NoteSearchQuery): Promise<Note[]> {
    // Reload index if dirty
    if (this.indexDirty) {
      await this.loadIndex();
    }

    let results = Array.from(this.cache.values());

    // Filter by archived status
    if (!query.includeArchived) {
      results = results.filter((n) => !n.metadata.isArchived);
    }

    // Filter by pinned only
    if (query.pinnedOnly) {
      results = results.filter((n) => n.metadata.isPinned);
    }

    // Filter by category
    if (query.category) {
      results = results.filter((n) => n.metadata.category === query.category);
    }

    // Filter by priority
    if (query.priority) {
      results = results.filter((n) => n.metadata.priority === query.priority);
    }

    // Filter by tags (any match)
    if (query.tags && query.tags.length > 0) {
      results = results.filter((n) =>
        query.tags!.some((tag) => n.metadata.tags.includes(tag.toLowerCase()))
      );
    }

    // Filter by date range
    if (query.createdAfter) {
      const afterTime = query.createdAfter.getTime();
      results = results.filter((n) => new Date(n.metadata.createdAt).getTime() >= afterTime);
    }

    if (query.createdBefore) {
      const beforeTime = query.createdBefore.getTime();
      results = results.filter((n) => new Date(n.metadata.createdAt).getTime() <= beforeTime);
    }

    // Text search (case-insensitive)
    if (query.text) {
      const searchText = query.text.toLowerCase();
      results = results.filter(
        (n) =>
          n.metadata.title.toLowerCase().includes(searchText) ||
          n.content.toLowerCase().includes(searchText) ||
          n.metadata.tags.some((t) => t.toLowerCase().includes(searchText))
      );
    }

    // Sort results
    const sortBy = query.sortBy || 'updatedAt';
    const sortOrder = query.sortOrder || 'desc';
    const sortMultiplier = sortOrder === 'desc' ? -1 : 1;

    results.sort((a, b) => {
      let comparison = 0;

      // Pinned notes always first
      if (a.metadata.isPinned && !b.metadata.isPinned) return -1;
      if (!a.metadata.isPinned && b.metadata.isPinned) return 1;

      switch (sortBy) {
        case 'title':
          comparison = a.metadata.title.localeCompare(b.metadata.title);
          break;
        case 'priority': {
          const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
          comparison = priorityOrder[a.metadata.priority] - priorityOrder[b.metadata.priority];
          break;
        }
        case 'createdAt':
          comparison =
            new Date(a.metadata.createdAt).getTime() - new Date(b.metadata.createdAt).getTime();
          break;
        case 'updatedAt':
        default:
          comparison =
            new Date(a.metadata.updatedAt).getTime() - new Date(b.metadata.updatedAt).getTime();
          break;
      }

      return comparison * sortMultiplier;
    });

    // Apply limit
    if (query.limit && query.limit > 0) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Get all notes (with optional limit)
   */
  async getAll(limit?: number): Promise<Note[]> {
    return this.search({ limit, sortBy: 'updatedAt', sortOrder: 'desc' });
  }

  /**
   * Get notes by category
   */
  async getByCategory(category: NoteCategory, limit?: number): Promise<Note[]> {
    return this.search({ category, limit, sortBy: 'updatedAt', sortOrder: 'desc' });
  }

  /**
   * Get notes by tag
   */
  async getByTag(tag: string, limit?: number): Promise<Note[]> {
    return this.search({ tags: [tag], limit, sortBy: 'updatedAt', sortOrder: 'desc' });
  }

  /**
   * Get recent notes
   */
  async getRecent(limit = 10): Promise<Note[]> {
    return this.search({ limit, sortBy: 'updatedAt', sortOrder: 'desc' });
  }

  /**
   * Get pinned notes
   */
  async getPinned(): Promise<Note[]> {
    return this.search({ pinnedOnly: true, sortBy: 'updatedAt', sortOrder: 'desc' });
  }

  /**
   * Get all unique tags
   */
  async getAllTags(): Promise<string[]> {
    if (this.indexDirty) {
      await this.loadIndex();
    }

    const tagSet = new Set<string>();
    for (const note of this.cache.values()) {
      for (const tag of note.metadata.tags) {
        tagSet.add(tag);
      }
    }

    return Array.from(tagSet).sort();
  }

  /**
   * Get storage statistics
   */
  getStats(): {
    totalNotes: number;
    byCategory: Record<NoteCategory, number>;
    byPriority: Record<NotePriority, number>;
    pinnedCount: number;
    archivedCount: number;
    totalWords: number;
    tagCount: number;
  } {
    const stats = {
      totalNotes: 0,
      byCategory: {
        general: 0,
        idea: 0,
        task: 0,
        reminder: 0,
        meeting: 0,
        journal: 0,
        reference: 0,
        quick: 0,
      } as Record<NoteCategory, number>,
      byPriority: {
        low: 0,
        medium: 0,
        high: 0,
        urgent: 0,
      } as Record<NotePriority, number>,
      pinnedCount: 0,
      archivedCount: 0,
      totalWords: 0,
      tagCount: 0,
    };

    const tags = new Set<string>();

    for (const note of this.cache.values()) {
      stats.totalNotes++;
      stats.byCategory[note.metadata.category]++;
      stats.byPriority[note.metadata.priority]++;
      stats.totalWords += note.metadata.wordCount;

      if (note.metadata.isPinned) stats.pinnedCount++;
      if (note.metadata.isArchived) stats.archivedCount++;

      for (const tag of note.metadata.tags) {
        tags.add(tag);
      }
    }

    stats.tagCount = tags.size;

    return stats;
  }

  /**
   * Export a note to a file
   */
  async exportNote(id: string, exportPath: string): Promise<boolean> {
    const note = await this.get(id);
    if (!note) {
      return false;
    }

    try {
      // Export as clean markdown (without frontmatter)
      const content = `# ${note.metadata.title}\n\n${note.content}`;
      await fs.promises.writeFile(exportPath, content, 'utf-8');
      logger.info('Note exported', { id, path: exportPath });
      return true;
    } catch (error) {
      logger.error('Failed to export note', { id, error: (error as Error).message });
      return false;
    }
  }

  /**
   * Export all notes to a directory
   */
  async exportAll(exportDir: string): Promise<{ exported: number; failed: number }> {
    const notes = await this.getAll();
    let exported = 0;
    let failed = 0;

    await fs.promises.mkdir(exportDir, { recursive: true });

    for (const note of notes) {
      const filename = `${note.metadata.title.replace(/[^a-z0-9]/gi, '-')}.md`;
      const exportPath = path.join(exportDir, filename);

      if (await this.exportNote(note.metadata.id, exportPath)) {
        exported++;
      } else {
        failed++;
      }
    }

    logger.info('Bulk export completed', { exported, failed });
    return { exported, failed };
  }

  /**
   * Import a note from file
   */
  async importNote(filePath: string, category?: NoteCategory): Promise<Note | null> {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const title = path.basename(filePath, '.md');

      return await this.create({
        content,
        title,
        category: category || 'general',
        source: 'import',
      });
    } catch (error) {
      logger.error('Failed to import note', { filePath, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Shutdown storage (close watchers, save pending changes)
   */
  async shutdown(): Promise<void> {
    this.stopFileWatch();
    this.cache.clear();
    logger.info('NotesStorage shutdown complete');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let storageInstance: NotesStorage | null = null;

/**
 * Get or create the notes storage instance
 */
export async function getNotesStorage(
  config?: Partial<NotesStorageConfig>
): Promise<NotesStorage> {
  if (!storageInstance) {
    storageInstance = new NotesStorage(config);
    await storageInstance.initialize();
  }
  return storageInstance;
}

/**
 * Shutdown the notes storage instance
 */
export async function shutdownNotesStorage(): Promise<void> {
  if (storageInstance) {
    await storageInstance.shutdown();
    storageInstance = null;
  }
}

export default NotesStorage;
