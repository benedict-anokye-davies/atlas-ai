/**
 * Atlas Desktop - Notes Module
 * Voice-first note taking system
 *
 * @module notes
 */

// Export storage types and functions
export {
  NotesStorage,
  getNotesStorage,
  shutdownNotesStorage,
  type Note,
  type NoteMetadata,
  type NoteCategory,
  type NotePriority,
  type CreateNoteInput,
  type UpdateNoteInput,
  type NoteSearchQuery,
  type NotesStorageConfig,
} from './storage';

// Export manager types and functions
export {
  NotesManager,
  getNotesManager,
  shutdownNotesManager,
  type NoteCommand,
  type ParsedNoteCommand,
  type CommandResult,
  type NotesManagerConfig,
  type NotesManagerEvents,
} from './manager';
