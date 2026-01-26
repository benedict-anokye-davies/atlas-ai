/**
 * Atlas Desktop - Notes Types
 * Shared type definitions for the notes system
 *
 * @module shared/types/notes
 */

// ============================================================================
// Note Types
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
 * Note source (how the note was created)
 */
export type NoteSource = 'voice' | 'text' | 'import';

/**
 * Note metadata
 */
export interface NoteMetadata {
  /** Unique note identifier */
  id: string;
  /** Note title */
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
  /** Source of the note */
  source: NoteSource;
  /** Whether this is a quick capture note */
  isQuickCapture: boolean;
  /** Whether the note is pinned */
  isPinned: boolean;
  /** Whether the note is archived */
  isArchived: boolean;
  /** Associated memory entry ID */
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
  /** File path on disk */
  filePath: string;
}

// ============================================================================
// Note Input/Output Types
// ============================================================================

/**
 * Input for creating a new note
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
  source?: NoteSource;
  /** Quick capture mode flag */
  isQuickCapture?: boolean;
}

/**
 * Input for updating an existing note
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
 * Search query parameters
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
  /** Created after date (ISO 8601) */
  createdAfter?: string;
  /** Created before date (ISO 8601) */
  createdBefore?: string;
  /** Maximum number of results */
  limit?: number;
  /** Sort field */
  sortBy?: 'createdAt' | 'updatedAt' | 'title' | 'priority';
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
}

// ============================================================================
// Voice Command Types
// ============================================================================

/**
 * Voice command types for notes
 */
export type NoteCommand =
  | 'create'
  | 'read'
  | 'search'
  | 'list'
  | 'update'
  | 'delete'
  | 'archive'
  | 'pin'
  | 'unpin'
  | 'export'
  | 'quick'
  | 'tag';

/**
 * Parsed voice command result
 */
export interface ParsedNoteCommand {
  /** Detected command type */
  command: NoteCommand;
  /** Extracted content/query */
  content?: string;
  /** Extracted category */
  category?: NoteCategory;
  /** Extracted tags */
  tags?: string[];
  /** Extracted priority */
  priority?: NotePriority;
  /** Target note ID or search term */
  target?: string;
  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * Command execution result
 */
export interface NoteCommandResult {
  /** Whether command was successful */
  success: boolean;
  /** Human-readable response for TTS */
  response: string;
  /** Associated notes (if applicable) */
  notes?: Note[];
  /** Error message if failed */
  error?: string;
}

// ============================================================================
// Statistics Types
// ============================================================================

/**
 * Notes storage statistics
 */
export interface NotesStats {
  /** Total number of notes */
  totalNotes: number;
  /** Notes by category */
  byCategory: Record<NoteCategory, number>;
  /** Notes by priority */
  byPriority: Record<NotePriority, number>;
  /** Number of pinned notes */
  pinnedCount: number;
  /** Number of archived notes */
  archivedCount: number;
  /** Total word count across all notes */
  totalWords: number;
  /** Number of unique tags */
  tagCount: number;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Notes manager configuration
 */
export interface NotesManagerConfig {
  /** Enable quick capture mode by default */
  quickCaptureDefault: boolean;
  /** Default category for new notes */
  defaultCategory: NoteCategory;
  /** Default priority for new notes */
  defaultPriority: NotePriority;
  /** Maximum notes to read aloud */
  maxReadAloud: number;
  /** Maximum search results */
  maxSearchResults: number;
  /** Sync with memory system */
  syncWithMemory: boolean;
}

/**
 * Notes storage configuration
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

// ============================================================================
// IPC Types
// ============================================================================

/**
 * IPC result for notes operations
 */
export interface NotesIPCResult<T = unknown> {
  /** Whether the operation was successful */
  success: boolean;
  /** Operation result data */
  data?: T;
  /** Error message if failed */
  error?: string;
}
