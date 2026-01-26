/**
 * Atlas Desktop - Notes Manager
 * Voice-first note taking system with command parsing and memory integration
 *
 * Handles voice commands like:
 * - "Take a note" / "Note this down" / "Remember this"
 * - "Read my notes" / "Show recent notes" / "What did I note about X"
 * - "Find note about X" / "Search notes for X"
 * - "Delete note X" / "Archive note X"
 * - "Export my notes"
 *
 * @module notes/manager
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as os from 'os';
import { createModuleLogger } from '../utils/logger';
import {
  NotesStorage,
  getNotesStorage,
  shutdownNotesStorage,
  Note,
  NoteCategory,
  NotePriority,
  CreateNoteInput,
  UpdateNoteInput,
  NoteSearchQuery,
} from './storage';

const logger = createModuleLogger('NotesManager');

// ============================================================================
// Types
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
export interface CommandResult {
  /** Whether command was successful */
  success: boolean;
  /** Human-readable response for TTS */
  response: string;
  /** Associated notes (if applicable) */
  notes?: Note[];
  /** Error message if failed */
  error?: string;
}

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
 * Default manager configuration
 */
const DEFAULT_MANAGER_CONFIG: NotesManagerConfig = {
  quickCaptureDefault: false,
  defaultCategory: 'general',
  defaultPriority: 'medium',
  maxReadAloud: 5,
  maxSearchResults: 20,
  syncWithMemory: true,
};

/**
 * Notes manager events
 */
export interface NotesManagerEvents {
  /** Note created */
  'note-created': (note: Note) => void;
  /** Note updated */
  'note-updated': (note: Note) => void;
  /** Note deleted */
  'note-deleted': (id: string) => void;
  /** Command executed */
  'command-executed': (command: ParsedNoteCommand, result: CommandResult) => void;
  /** Error occurred */
  error: (error: Error) => void;
}

// ============================================================================
// Voice Command Patterns
// ============================================================================

/**
 * Voice patterns for command detection
 */
const COMMAND_PATTERNS: Array<{
  command: NoteCommand;
  patterns: RegExp[];
  confidence: number;
}> = [
  {
    command: 'quick',
    patterns: [
      /^(?:quick\s+)?(?:note|capture)(?:\s+this)?[:\s]*(.+)?$/i,
      /^(?:jot\s+(?:down|this))[:\s]*(.+)?$/i,
      /^(?:remember\s+(?:this|that))[:\s]*(.+)?$/i,
    ],
    confidence: 0.9,
  },
  {
    command: 'create',
    patterns: [
      /^(?:take|make|create|add|new)\s+(?:a\s+)?note[:\s]*(.+)?$/i,
      /^(?:note\s+(?:this|that|down))[:\s]*(.+)?$/i,
      /^(?:write\s+(?:down|this))[:\s]*(.+)?$/i,
      /^(?:save\s+(?:a\s+)?note)[:\s]*(.+)?$/i,
    ],
    confidence: 0.95,
  },
  {
    command: 'read',
    patterns: [
      /^(?:read|show|display|get)\s+(?:my\s+)?(?:recent\s+)?notes?$/i,
      /^(?:what\s+(?:are|were)\s+my)\s+(?:recent\s+)?notes?$/i,
      /^(?:list|show)\s+(?:my\s+)?(?:all\s+)?notes?$/i,
      /^(?:read|show)\s+(?:the\s+)?(?:latest|last)\s+(?:\d+\s+)?notes?$/i,
    ],
    confidence: 0.9,
  },
  {
    command: 'search',
    patterns: [
      /^(?:find|search|look\s+for)\s+(?:a\s+)?notes?\s+(?:about|on|for|with|containing)[:\s]*(.+)$/i,
      /^(?:what\s+(?:did\s+I|have\s+I)\s+(?:note|write|jot)(?:d)?)\s+(?:about|on)[:\s]*(.+)$/i,
      /^(?:do\s+I\s+have\s+(?:a\s+)?notes?\s+(?:about|on))[:\s]*(.+)$/i,
      /^(?:search|find)\s+(?:notes?\s+)?(?:for)?[:\s]*(.+)$/i,
    ],
    confidence: 0.85,
  },
  {
    command: 'list',
    patterns: [
      /^(?:list|show|get)\s+(?:all\s+)?(?:my\s+)?(\w+)\s+notes?$/i,
      /^(?:show|list)\s+notes?\s+(?:tagged|with\s+tag)[:\s]*(.+)$/i,
      /^(?:what|which)\s+notes?\s+(?:are\s+)?tagged[:\s]*(.+)$/i,
    ],
    confidence: 0.85,
  },
  {
    command: 'delete',
    patterns: [
      /^(?:delete|remove|trash)\s+(?:the\s+)?(?:last\s+)?note(?:\s+about)?[:\s]*(.+)?$/i,
      /^(?:get\s+rid\s+of|throw\s+away)\s+(?:the\s+)?note[:\s]*(.+)?$/i,
    ],
    confidence: 0.8,
  },
  {
    command: 'archive',
    patterns: [
      /^(?:archive|store|file\s+away)\s+(?:the\s+)?note[:\s]*(.+)?$/i,
      /^(?:move\s+(?:the\s+)?note\s+to\s+archive)[:\s]*(.+)?$/i,
    ],
    confidence: 0.85,
  },
  {
    command: 'pin',
    patterns: [
      /^(?:pin|star|favorite)\s+(?:the\s+)?(?:last\s+)?note[:\s]*(.+)?$/i,
      /^(?:mark\s+(?:the\s+)?note\s+as\s+important)[:\s]*(.+)?$/i,
    ],
    confidence: 0.85,
  },
  {
    command: 'unpin',
    patterns: [
      /^(?:unpin|unstar|unfavorite)\s+(?:the\s+)?note[:\s]*(.+)?$/i,
      /^(?:remove\s+pin\s+from\s+(?:the\s+)?note)[:\s]*(.+)?$/i,
    ],
    confidence: 0.85,
  },
  {
    command: 'export',
    patterns: [
      /^(?:export|save|backup)\s+(?:my\s+)?(?:all\s+)?notes?$/i,
      /^(?:download|get)\s+(?:my\s+)?notes?\s+(?:as\s+files?)?$/i,
    ],
    confidence: 0.9,
  },
  {
    command: 'tag',
    patterns: [
      /^(?:tag|label)\s+(?:the\s+)?(?:last\s+)?note\s+(?:as|with)[:\s]*(.+)$/i,
      /^(?:add\s+tag)\s+(.+)\s+to\s+(?:the\s+)?(?:last\s+)?note$/i,
    ],
    confidence: 0.85,
  },
];

/**
 * Category detection patterns
 */
const CATEGORY_PATTERNS: Array<{ category: NoteCategory; patterns: RegExp[] }> = [
  {
    category: 'idea',
    patterns: [/\b(?:idea|thought|concept|brainstorm)\b/i],
  },
  {
    category: 'task',
    patterns: [/\b(?:task|todo|to-do|to\s+do|action\s+item)\b/i],
  },
  {
    category: 'reminder',
    patterns: [/\b(?:remind|reminder|don't\s+forget|remember\s+to)\b/i],
  },
  {
    category: 'meeting',
    patterns: [/\b(?:meeting|call|conference|standup|sync)\b/i],
  },
  {
    category: 'journal',
    patterns: [/\b(?:journal|diary|daily|today|reflection)\b/i],
  },
  {
    category: 'reference',
    patterns: [/\b(?:reference|lookup|definition|how\s+to)\b/i],
  },
];

/**
 * Priority detection patterns
 */
const PRIORITY_PATTERNS: Array<{ priority: NotePriority; patterns: RegExp[] }> = [
  {
    priority: 'urgent',
    patterns: [/\b(?:urgent|asap|immediately|critical|emergency)\b/i],
  },
  {
    priority: 'high',
    patterns: [/\b(?:important|high\s+priority|priority|crucial)\b/i],
  },
  {
    priority: 'low',
    patterns: [/\b(?:low\s+priority|not\s+urgent|whenever|someday)\b/i],
  },
];

/**
 * Tag extraction pattern
 */
const TAG_PATTERN = /#(\w+)/g;

// ============================================================================
// Notes Manager Implementation
// ============================================================================

/**
 * Notes Manager
 *
 * Provides voice-first interface for note taking with natural language
 * command parsing and memory system integration.
 */
export class NotesManager extends EventEmitter {
  private config: NotesManagerConfig;
  private storage: NotesStorage | null = null;
  private lastCreatedNoteId: string | null = null;
  private quickCaptureMode = false;

  constructor(config?: Partial<NotesManagerConfig>) {
    super();
    this.config = { ...DEFAULT_MANAGER_CONFIG, ...config };
    this.quickCaptureMode = this.config.quickCaptureDefault;
    logger.info('NotesManager initialized', { config: this.config });
  }

  /**
   * Initialize the manager
   */
  async initialize(): Promise<void> {
    try {
      this.storage = await getNotesStorage();
      logger.info('NotesManager initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize NotesManager', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Parse a voice command string
   */
  parseCommand(input: string): ParsedNoteCommand | null {
    const trimmedInput = input.trim();

    // Try to match against command patterns
    for (const { command, patterns, confidence } of COMMAND_PATTERNS) {
      for (const pattern of patterns) {
        const match = trimmedInput.match(pattern);
        if (match) {
          const parsed: ParsedNoteCommand = {
            command,
            content: match[1]?.trim() || undefined,
            confidence,
          };

          // Extract category from content
          if (parsed.content) {
            parsed.category = this.detectCategory(parsed.content);
            parsed.priority = this.detectPriority(parsed.content);
            parsed.tags = this.extractTags(parsed.content);
          }

          logger.debug('Command parsed', { input: trimmedInput, parsed });
          return parsed;
        }
      }
    }

    return null;
  }

  /**
   * Detect category from content
   */
  private detectCategory(content: string): NoteCategory | undefined {
    for (const { category, patterns } of CATEGORY_PATTERNS) {
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          return category;
        }
      }
    }
    return undefined;
  }

  /**
   * Detect priority from content
   */
  private detectPriority(content: string): NotePriority | undefined {
    for (const { priority, patterns } of PRIORITY_PATTERNS) {
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          return priority;
        }
      }
    }
    return undefined;
  }

  /**
   * Extract tags from content
   */
  private extractTags(content: string): string[] {
    const tags: string[] = [];
    let match;
    while ((match = TAG_PATTERN.exec(content)) !== null) {
      tags.push(match[1].toLowerCase());
    }
    return tags;
  }

  /**
   * Execute a parsed command
   */
  async executeCommand(parsed: ParsedNoteCommand): Promise<CommandResult> {
    if (!this.storage) {
      return {
        success: false,
        response: 'Notes system is not initialized yet.',
        error: 'Storage not initialized',
      };
    }

    try {
      let result: CommandResult;

      switch (parsed.command) {
        case 'create':
        case 'quick':
          result = await this.handleCreateCommand(parsed);
          break;
        case 'read':
        case 'list':
          result = await this.handleReadCommand(parsed);
          break;
        case 'search':
          result = await this.handleSearchCommand(parsed);
          break;
        case 'delete':
          result = await this.handleDeleteCommand(parsed);
          break;
        case 'archive':
          result = await this.handleArchiveCommand(parsed);
          break;
        case 'pin':
          result = await this.handlePinCommand(parsed, true);
          break;
        case 'unpin':
          result = await this.handlePinCommand(parsed, false);
          break;
        case 'export':
          result = await this.handleExportCommand(parsed);
          break;
        case 'tag':
          result = await this.handleTagCommand(parsed);
          break;
        default:
          result = {
            success: false,
            response: "I'm not sure how to handle that note command.",
            error: `Unknown command: ${parsed.command}`,
          };
      }

      this.emit('command-executed', parsed, result);
      return result;
    } catch (error) {
      const errorResult: CommandResult = {
        success: false,
        response: 'Sorry, something went wrong while handling your note request.',
        error: (error as Error).message,
      };
      this.emit('error', error as Error);
      return errorResult;
    }
  }

  /**
   * Handle voice input (parse and execute)
   */
  async handleVoiceInput(input: string): Promise<CommandResult> {
    const parsed = this.parseCommand(input);

    if (!parsed) {
      // If in quick capture mode, treat any input as a new note
      if (this.quickCaptureMode) {
        return this.handleCreateCommand({
          command: 'quick',
          content: input,
          confidence: 0.7,
        });
      }

      return {
        success: false,
        response:
          "I didn't understand that as a note command. Try saying 'take a note' or 'read my notes'.",
      };
    }

    return this.executeCommand(parsed);
  }

  // ===========================================================================
  // Command Handlers
  // ===========================================================================

  /**
   * Handle create/quick note command
   */
  private async handleCreateCommand(parsed: ParsedNoteCommand): Promise<CommandResult> {
    if (!parsed.content) {
      return {
        success: false,
        response: 'What would you like me to note down?',
      };
    }

    const input: CreateNoteInput = {
      content: parsed.content,
      category: parsed.category || this.config.defaultCategory,
      tags: parsed.tags || [],
      priority: parsed.priority || this.config.defaultPriority,
      source: 'voice',
      isQuickCapture: parsed.command === 'quick',
    };

    const note = await this.storage!.create(input);
    this.lastCreatedNoteId = note.metadata.id;

    this.emit('note-created', note);

    const categoryText = input.category !== 'general' ? ` as a ${input.category} note` : '';
    const tagsText =
      input.tags && input.tags.length > 0 ? ` with tags ${input.tags.join(', ')}` : '';

    return {
      success: true,
      response: `Got it! I've saved your note${categoryText}${tagsText}.`,
      notes: [note],
    };
  }

  /**
   * Handle read/list command
   */
  private async handleReadCommand(parsed: ParsedNoteCommand): Promise<CommandResult> {
    const query: NoteSearchQuery = {
      limit: this.config.maxReadAloud,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    };

    // Check for category filter in content
    if (parsed.content) {
      const categoryMatch = parsed.content.match(/(\w+)\s+notes?/i);
      if (categoryMatch) {
        const category = this.detectCategoryFromWord(categoryMatch[1]);
        if (category) {
          query.category = category;
        }
      }

      // Check for tag filter
      const tagMatch = parsed.content.match(/(?:tagged|with\s+tag)\s+(\w+)/i);
      if (tagMatch) {
        query.tags = [tagMatch[1].toLowerCase()];
      }
    }

    const notes = await this.storage!.search(query);

    if (notes.length === 0) {
      const filterText = query.category ? ` in ${query.category}` : '';
      return {
        success: true,
        response: `You don't have any notes${filterText} yet.`,
        notes: [],
      };
    }

    // Build response
    const noteSummaries = notes.map((n, i) => {
      const preview =
        n.metadata.title.length > 50 ? n.metadata.title.substring(0, 47) + '...' : n.metadata.title;
      return `${i + 1}. ${preview}`;
    });

    const intro =
      notes.length === 1
        ? 'Here is your most recent note:'
        : `Here are your ${notes.length} most recent notes:`;

    return {
      success: true,
      response: `${intro} ${noteSummaries.join('. ')}`,
      notes,
    };
  }

  /**
   * Handle search command
   */
  private async handleSearchCommand(parsed: ParsedNoteCommand): Promise<CommandResult> {
    if (!parsed.content) {
      return {
        success: false,
        response: 'What would you like me to search for in your notes?',
      };
    }

    const notes = await this.storage!.search({
      text: parsed.content,
      limit: this.config.maxSearchResults,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });

    if (notes.length === 0) {
      return {
        success: true,
        response: `I couldn't find any notes about "${parsed.content}".`,
        notes: [],
      };
    }

    const noteSummaries = notes
      .slice(0, 3)
      .map((n) => n.metadata.title)
      .join(', ');
    const moreText = notes.length > 3 ? ` and ${notes.length - 3} more` : '';

    return {
      success: true,
      response: `I found ${notes.length} note${notes.length === 1 ? '' : 's'} about "${parsed.content}": ${noteSummaries}${moreText}.`,
      notes,
    };
  }

  /**
   * Handle delete command
   */
  private async handleDeleteCommand(parsed: ParsedNoteCommand): Promise<CommandResult> {
    let noteId: string | null = null;

    if (parsed.content) {
      // Search for note by content
      const notes = await this.storage!.search({ text: parsed.content, limit: 1 });
      if (notes.length > 0) {
        noteId = notes[0].metadata.id;
      }
    } else if (this.lastCreatedNoteId) {
      // Delete last created note
      noteId = this.lastCreatedNoteId;
    }

    if (!noteId) {
      return {
        success: false,
        response: "I couldn't find that note. Could you be more specific?",
      };
    }

    const note = await this.storage!.get(noteId);
    const deleted = await this.storage!.delete(noteId);

    if (deleted) {
      if (noteId === this.lastCreatedNoteId) {
        this.lastCreatedNoteId = null;
      }
      this.emit('note-deleted', noteId);
      return {
        success: true,
        response: `I've deleted the note "${note?.metadata.title || 'untitled'}".`,
      };
    }

    return {
      success: false,
      response: "I couldn't delete that note. Please try again.",
    };
  }

  /**
   * Handle archive command
   */
  private async handleArchiveCommand(parsed: ParsedNoteCommand): Promise<CommandResult> {
    let noteId: string | null = null;

    if (parsed.content) {
      const notes = await this.storage!.search({ text: parsed.content, limit: 1 });
      if (notes.length > 0) {
        noteId = notes[0].metadata.id;
      }
    } else if (this.lastCreatedNoteId) {
      noteId = this.lastCreatedNoteId;
    }

    if (!noteId) {
      return {
        success: false,
        response: "I couldn't find that note. Could you be more specific?",
      };
    }

    const note = await this.storage!.update(noteId, { isArchived: true });

    if (note) {
      this.emit('note-updated', note);
      return {
        success: true,
        response: `I've archived the note "${note.metadata.title}".`,
        notes: [note],
      };
    }

    return {
      success: false,
      response: "I couldn't archive that note. Please try again.",
    };
  }

  /**
   * Handle pin/unpin command
   */
  private async handlePinCommand(parsed: ParsedNoteCommand, pin: boolean): Promise<CommandResult> {
    let noteId: string | null = null;

    if (parsed.content) {
      const notes = await this.storage!.search({ text: parsed.content, limit: 1 });
      if (notes.length > 0) {
        noteId = notes[0].metadata.id;
      }
    } else if (this.lastCreatedNoteId) {
      noteId = this.lastCreatedNoteId;
    }

    if (!noteId) {
      return {
        success: false,
        response: "I couldn't find that note. Could you be more specific?",
      };
    }

    const note = await this.storage!.update(noteId, { isPinned: pin });

    if (note) {
      this.emit('note-updated', note);
      const action = pin ? 'pinned' : 'unpinned';
      return {
        success: true,
        response: `I've ${action} the note "${note.metadata.title}".`,
        notes: [note],
      };
    }

    return {
      success: false,
      response: `I couldn't ${pin ? 'pin' : 'unpin'} that note. Please try again.`,
    };
  }

  /**
   * Handle export command
   */
  private async handleExportCommand(_parsed: ParsedNoteCommand): Promise<CommandResult> {
    const stats = this.storage!.getStats();

    if (stats.totalNotes === 0) {
      return {
        success: false,
        response: "You don't have any notes to export.",
      };
    }

    // Export to default location
    const exportDir = path.join(os.homedir(), 'Documents', 'Atlas Notes Export');

    const result = await this.storage!.exportAll(exportDir);

    if (result.exported > 0) {
      return {
        success: true,
        response: `I've exported ${result.exported} note${result.exported === 1 ? '' : 's'} to your Documents folder.${result.failed > 0 ? ` ${result.failed} notes couldn't be exported.` : ''}`,
      };
    }

    return {
      success: false,
      response: "I couldn't export your notes. Please try again.",
    };
  }

  /**
   * Handle tag command
   */
  private async handleTagCommand(parsed: ParsedNoteCommand): Promise<CommandResult> {
    if (!parsed.content) {
      return {
        success: false,
        response: 'What tag would you like to add?',
      };
    }

    const noteId = this.lastCreatedNoteId;
    if (!noteId) {
      return {
        success: false,
        response: "I don't have a recent note to tag. Please specify which note to tag.",
      };
    }

    const note = await this.storage!.get(noteId);
    if (!note) {
      return {
        success: false,
        response: "I couldn't find that note.",
      };
    }

    // Parse tags from content
    const newTags = parsed.content.split(/[,\s]+/).map((t) => t.replace(/^#/, '').toLowerCase());
    const updatedTags = [...new Set([...note.metadata.tags, ...newTags])];

    const updated = await this.storage!.update(noteId, { tags: updatedTags });

    if (updated) {
      this.emit('note-updated', updated);
      return {
        success: true,
        response: `I've added the tag${newTags.length === 1 ? '' : 's'} ${newTags.join(', ')} to your note.`,
        notes: [updated],
      };
    }

    return {
      success: false,
      response: "I couldn't add the tags. Please try again.",
    };
  }

  /**
   * Detect category from a single word
   */
  private detectCategoryFromWord(word: string): NoteCategory | undefined {
    const wordLower = word.toLowerCase();
    const categoryMap: Record<string, NoteCategory> = {
      idea: 'idea',
      ideas: 'idea',
      task: 'task',
      tasks: 'task',
      todo: 'task',
      todos: 'task',
      reminder: 'reminder',
      reminders: 'reminder',
      meeting: 'meeting',
      meetings: 'meeting',
      journal: 'journal',
      journals: 'journal',
      diary: 'journal',
      reference: 'reference',
      references: 'reference',
      quick: 'quick',
      general: 'general',
    };
    return categoryMap[wordLower];
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Create a note directly (bypassing voice parsing)
   */
  async createNote(input: CreateNoteInput): Promise<Note> {
    if (!this.storage) {
      throw new Error('NotesManager not initialized');
    }

    const note = await this.storage.create(input);
    this.lastCreatedNoteId = note.metadata.id;
    this.emit('note-created', note);
    return note;
  }

  /**
   * Get a note by ID
   */
  async getNote(id: string): Promise<Note | null> {
    if (!this.storage) {
      throw new Error('NotesManager not initialized');
    }
    return this.storage.get(id);
  }

  /**
   * Update a note directly
   */
  async updateNote(id: string, input: UpdateNoteInput): Promise<Note | null> {
    if (!this.storage) {
      throw new Error('NotesManager not initialized');
    }

    const note = await this.storage.update(id, input);
    if (note) {
      this.emit('note-updated', note);
    }
    return note;
  }

  /**
   * Delete a note directly
   */
  async deleteNote(id: string): Promise<boolean> {
    if (!this.storage) {
      throw new Error('NotesManager not initialized');
    }

    const deleted = await this.storage.delete(id);
    if (deleted) {
      if (id === this.lastCreatedNoteId) {
        this.lastCreatedNoteId = null;
      }
      this.emit('note-deleted', id);
    }
    return deleted;
  }

  /**
   * Search notes
   */
  async searchNotes(query: NoteSearchQuery): Promise<Note[]> {
    if (!this.storage) {
      throw new Error('NotesManager not initialized');
    }
    return this.storage.search(query);
  }

  /**
   * Get recent notes
   */
  async getRecentNotes(limit?: number): Promise<Note[]> {
    if (!this.storage) {
      throw new Error('NotesManager not initialized');
    }
    return this.storage.getRecent(limit);
  }

  /**
   * Get all tags
   */
  async getAllTags(): Promise<string[]> {
    if (!this.storage) {
      throw new Error('NotesManager not initialized');
    }
    return this.storage.getAllTags();
  }

  /**
   * Get storage statistics
   */
  getStats(): ReturnType<NotesStorage['getStats']> | null {
    return this.storage?.getStats() || null;
  }

  /**
   * Enable or disable quick capture mode
   */
  setQuickCaptureMode(enabled: boolean): void {
    this.quickCaptureMode = enabled;
    logger.info('Quick capture mode changed', { enabled });
  }

  /**
   * Check if quick capture mode is enabled
   */
  isQuickCaptureModeEnabled(): boolean {
    return this.quickCaptureMode;
  }

  /**
   * Get the last created note ID
   */
  getLastCreatedNoteId(): string | null {
    return this.lastCreatedNoteId;
  }

  /**
   * Sync a note with the memory system
   */
  async syncWithMemory(noteId: string, memoryId: string): Promise<boolean> {
    if (!this.storage || !this.config.syncWithMemory) {
      return false;
    }

    const note = await this.storage.update(noteId, {});
    if (note) {
      // Update the memoryId in metadata
      note.metadata.memoryId = memoryId;
      return true;
    }
    return false;
  }

  /**
   * Shutdown the manager
   */
  async shutdown(): Promise<void> {
    await shutdownNotesStorage();
    this.storage = null;
    this.removeAllListeners();
    logger.info('NotesManager shutdown complete');
  }

  // Type-safe event emitter methods
  on<K extends keyof NotesManagerEvents>(event: K, listener: NotesManagerEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof NotesManagerEvents>(event: K, listener: NotesManagerEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof NotesManagerEvents>(
    event: K,
    ...args: Parameters<NotesManagerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let managerInstance: NotesManager | null = null;

/**
 * Get or create the notes manager instance
 */
export async function getNotesManager(config?: Partial<NotesManagerConfig>): Promise<NotesManager> {
  if (!managerInstance) {
    managerInstance = new NotesManager(config);
    await managerInstance.initialize();
  }
  return managerInstance;
}

/**
 * Shutdown the notes manager instance
 */
export async function shutdownNotesManager(): Promise<void> {
  if (managerInstance) {
    await managerInstance.shutdown();
    managerInstance = null;
  }
}

export default NotesManager;
