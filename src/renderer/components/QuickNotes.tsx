/**
 * Atlas Desktop - Quick Notes Feature
 * Voice-triggered note taking with organization
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import './QuickNotes.css';

// ============================================================================
// Types
// ============================================================================

interface Note {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  pinned: boolean;
  color: NoteColor;
}

type NoteColor = 'default' | 'purple' | 'blue' | 'green' | 'yellow' | 'red';

interface QuickNotesProps {
  isVisible: boolean;
  onClose: () => void;
}

// ============================================================================
// Icons
// ============================================================================

const NoteIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const PlusIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const SearchIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const PinIcon: React.FC<{ className?: string; filled?: boolean }> = ({ className, filled }) => (
  <svg className={className} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
    <path d="M12 2l2 7h7l-6 4 2 7-5-4-5 4 2-7-6-4h7z" />
  </svg>
);

const TrashIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const TagIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

const MicIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

// ============================================================================
// Constants
// ============================================================================

const NOTE_COLORS: { id: NoteColor; hex: string; name: string }[] = [
  { id: 'default', hex: '#1f1f2e', name: 'Default' },
  { id: 'purple', hex: '#3d2f5b', name: 'Purple' },
  { id: 'blue', hex: '#1e3a5f', name: 'Blue' },
  { id: 'green', hex: '#1a4033', name: 'Green' },
  { id: 'yellow', hex: '#4a4520', name: 'Yellow' },
  { id: 'red', hex: '#4a2020', name: 'Red' },
];

// ============================================================================
// Main Component
// ============================================================================

export const QuickNotes: React.FC<QuickNotesProps> = ({ isVisible, onClose }) => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteTags, setNewNoteTags] = useState('');
  const [newNoteColor, setNewNoteColor] = useState<NoteColor>('default');
  const [isCreating, setIsCreating] = useState(false);
  const [isListening, setIsListening] = useState(false);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Load notes on mount
  useEffect(() => {
    const stored = localStorage.getItem('atlas:quick-notes');
    if (stored) {
      setNotes(JSON.parse(stored));
    }
  }, []);

  // Save notes when changed
  const saveNotes = useCallback((updated: Note[]) => {
    setNotes(updated);
    localStorage.setItem('atlas:quick-notes', JSON.stringify(updated));
  }, []);

  // Get all unique tags
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    notes.forEach(note => note.tags.forEach(tag => tags.add(tag)));
    return Array.from(tags).sort();
  }, [notes]);

  // Filter notes
  const filteredNotes = useMemo(() => {
    let filtered = notes;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(note =>
        note.content.toLowerCase().includes(query) ||
        note.tags.some(tag => tag.toLowerCase().includes(query))
      );
    }

    if (selectedTag) {
      filtered = filtered.filter(note => note.tags.includes(selectedTag));
    }

    // Sort: pinned first, then by updated
    return filtered.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.updatedAt - a.updatedAt;
    });
  }, [notes, searchQuery, selectedTag]);

  // Create note
  const createNote = useCallback(() => {
    if (!newNoteContent.trim()) return;

    const tags = newNoteTags
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 0);

    const note: Note = {
      id: `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      content: newNoteContent.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags,
      pinned: false,
      color: newNoteColor,
    };

    saveNotes([note, ...notes]);
    setNewNoteContent('');
    setNewNoteTags('');
    setNewNoteColor('default');
    setIsCreating(false);
  }, [newNoteContent, newNoteTags, newNoteColor, notes, saveNotes]);

  // Update note
  const updateNote = useCallback((updated: Note) => {
    const newNotes = notes.map(n => 
      n.id === updated.id ? { ...updated, updatedAt: Date.now() } : n
    );
    saveNotes(newNotes);
    setEditingNote(null);
  }, [notes, saveNotes]);

  // Delete note
  const deleteNote = useCallback((id: string) => {
    saveNotes(notes.filter(n => n.id !== id));
    if (editingNote?.id === id) {
      setEditingNote(null);
    }
  }, [notes, saveNotes, editingNote]);

  // Toggle pin
  const togglePin = useCallback((id: string) => {
    const newNotes = notes.map(n =>
      n.id === id ? { ...n, pinned: !n.pinned, updatedAt: Date.now() } : n
    );
    saveNotes(newNotes);
  }, [notes, saveNotes]);

  // Voice input
  const startVoiceInput = useCallback(async () => {
    setIsListening(true);
    try {
      // Start voice recognition via IPC - use voice pipeline
      const voiceAny = window.atlas?.voice as unknown as Record<string, unknown> | undefined;
      if (voiceAny?.start && typeof voiceAny.start === 'function') {
        await (voiceAny.start as () => Promise<void>)();
      }
      
      // Note: Voice transcription would be wired up via IPC events
      // For now, simulate with a timeout
      setTimeout(() => {
        setIsListening(false);
      }, 5000);
    } catch (error) {
      console.error('Voice input failed:', error);
      setIsListening(false);
    }
  }, []);

  // Format date
  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  // Focus textarea when creating
  useEffect(() => {
    if (isCreating && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isCreating]);

  // Focus textarea when editing
  useEffect(() => {
    if (editingNote && editTextareaRef.current) {
      editTextareaRef.current.focus();
    }
  }, [editingNote]);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingNote) {
          setEditingNote(null);
        } else if (isCreating) {
          setIsCreating(false);
        } else {
          onClose();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        setIsCreating(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, editingNote, isCreating, onClose]);

  if (!isVisible) return null;

  return (
    <div className="quick-notes-overlay">
      <div className="quick-notes-container">
        {/* Header */}
        <div className="qn-header">
          <div className="qn-title-row">
            <NoteIcon className="qn-icon" />
            <h2>Quick Notes</h2>
          </div>
          <div className="qn-header-actions">
            <button 
              className="qn-new-btn" 
              onClick={() => setIsCreating(true)}
              title="New Note (Ctrl+N)"
            >
              <PlusIcon /> New
            </button>
            <button className="qn-close" onClick={onClose}>
              <XIcon />
            </button>
          </div>
        </div>

        {/* Search & Tags */}
        <div className="qn-controls">
          <div className="search-box">
            <SearchIcon className="search-icon" />
            <input
              type="text"
              placeholder="Search notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {allTags.length > 0 && (
            <div className="tag-filter">
              <button
                className={`tag-btn ${!selectedTag ? 'active' : ''}`}
                onClick={() => setSelectedTag(null)}
              >
                All
              </button>
              {allTags.map(tag => (
                <button
                  key={tag}
                  className={`tag-btn ${selectedTag === tag ? 'active' : ''}`}
                  onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* New Note Form */}
        {isCreating && (
          <div className="qn-new-form">
            <div className="form-header">
              <span>New Note</span>
              <button className="form-close" onClick={() => setIsCreating(false)}>
                <XIcon />
              </button>
            </div>
            <textarea
              ref={textareaRef}
              placeholder="What's on your mind?"
              value={newNoteContent}
              onChange={(e) => setNewNoteContent(e.target.value)}
              rows={4}
            />
            <div className="form-row">
              <div className="tags-input">
                <TagIcon className="tag-icon" />
                <input
                  type="text"
                  placeholder="Tags (comma separated)"
                  value={newNoteTags}
                  onChange={(e) => setNewNoteTags(e.target.value)}
                />
              </div>
              <button 
                className={`voice-btn ${isListening ? 'listening' : ''}`}
                onClick={startVoiceInput}
                title="Voice input"
              >
                <MicIcon />
              </button>
            </div>
            <div className="form-row">
              <div className="color-picker">
                {NOTE_COLORS.map(color => (
                  <button
                    key={color.id}
                    className={`color-swatch ${newNoteColor === color.id ? 'selected' : ''}`}
                    style={{ backgroundColor: color.hex }}
                    onClick={() => setNewNoteColor(color.id)}
                    title={color.name}
                  />
                ))}
              </div>
              <div className="form-actions">
                <button className="cancel-btn" onClick={() => setIsCreating(false)}>
                  Cancel
                </button>
                <button 
                  className="save-btn" 
                  onClick={createNote}
                  disabled={!newNoteContent.trim()}
                >
                  Save Note
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Notes Grid */}
        <div className="qn-content">
          {filteredNotes.length === 0 ? (
            <div className="qn-empty">
              <NoteIcon className="empty-icon" />
              <p>{notes.length === 0 ? 'No notes yet' : 'No matching notes'}</p>
              <span>
                {notes.length === 0 
                  ? 'Click "New" to create your first note' 
                  : 'Try adjusting your search or filters'
                }
              </span>
            </div>
          ) : (
            <div className="notes-grid">
              {filteredNotes.map(note => (
                <div 
                  key={note.id} 
                  className={`note-card ${note.pinned ? 'pinned' : ''}`}
                  style={{ 
                    backgroundColor: NOTE_COLORS.find(c => c.id === note.color)?.hex || NOTE_COLORS[0].hex 
                  }}
                  onClick={() => setEditingNote(note)}
                >
                  <div className="note-actions">
                    <button 
                      className="pin-btn"
                      onClick={(e) => { e.stopPropagation(); togglePin(note.id); }}
                      title={note.pinned ? 'Unpin' : 'Pin'}
                    >
                      <PinIcon filled={note.pinned} />
                    </button>
                    <button 
                      className="delete-btn"
                      onClick={(e) => { e.stopPropagation(); deleteNote(note.id); }}
                      title="Delete"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                  <p className="note-content">{note.content}</p>
                  {note.tags.length > 0 && (
                    <div className="note-tags">
                      {note.tags.map(tag => (
                        <span key={tag} className="note-tag">#{tag}</span>
                      ))}
                    </div>
                  )}
                  <span className="note-date">{formatDate(note.updatedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Edit Modal */}
        {editingNote && (
          <div className="edit-modal-overlay" onClick={() => setEditingNote(null)}>
            <div 
              className="edit-modal" 
              onClick={(e) => e.stopPropagation()}
              style={{ 
                backgroundColor: NOTE_COLORS.find(c => c.id === editingNote.color)?.hex || NOTE_COLORS[0].hex 
              }}
            >
              <div className="edit-header">
                <span>Edit Note</span>
                <button onClick={() => setEditingNote(null)}>
                  <XIcon />
                </button>
              </div>
              <textarea
                ref={editTextareaRef}
                value={editingNote.content}
                onChange={(e) => setEditingNote({ ...editingNote, content: e.target.value })}
                rows={6}
              />
              <div className="edit-row">
                <div className="tags-input">
                  <TagIcon className="tag-icon" />
                  <input
                    type="text"
                    placeholder="Tags (comma separated)"
                    value={editingNote.tags.join(', ')}
                    onChange={(e) => setEditingNote({
                      ...editingNote,
                      tags: e.target.value.split(',').map(t => t.trim().toLowerCase()).filter(t => t)
                    })}
                  />
                </div>
              </div>
              <div className="edit-row">
                <div className="color-picker">
                  {NOTE_COLORS.map(color => (
                    <button
                      key={color.id}
                      className={`color-swatch ${editingNote.color === color.id ? 'selected' : ''}`}
                      style={{ backgroundColor: color.hex }}
                      onClick={() => setEditingNote({ ...editingNote, color: color.id })}
                      title={color.name}
                    />
                  ))}
                </div>
                <div className="edit-actions">
                  <button 
                    className="delete-btn-lg" 
                    onClick={() => deleteNote(editingNote.id)}
                  >
                    <TrashIcon /> Delete
                  </button>
                  <button 
                    className="save-btn" 
                    onClick={() => updateNote(editingNote)}
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default QuickNotes;
