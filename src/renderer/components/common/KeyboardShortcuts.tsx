/**
 * Atlas Desktop - Keyboard Shortcuts Component
 * Displays available keyboard shortcuts as a cheat sheet
 *
 * Session 039-A: Added focus management for keyboard navigation
 * Session 047-B: Updated to fetch dynamic shortcuts from API
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useModalFocus } from '../../hooks';
import { getShortcutCategory } from '../../../shared/types/shortcuts';

interface Shortcut {
  keys: string[];
  description: string;
  category: 'general' | 'voice' | 'navigation';
}

/**
 * Fallback shortcuts (used if API fetch fails)
 */
const FALLBACK_SHORTCUTS: Shortcut[] = [
  // General
  { keys: ['Ctrl', 'Shift', 'A'], description: 'Toggle Atlas window', category: 'general' },
  { keys: ['Esc'], description: 'Close current panel / Cancel', category: 'general' },
  { keys: ['?'], description: 'Show keyboard shortcuts', category: 'general' },

  // Voice
  { keys: ['Space'], description: 'Push to talk (hold)', category: 'voice' },
  { keys: ['Ctrl', 'M'], description: 'Toggle microphone', category: 'voice' },

  // Navigation
  { keys: ['Ctrl', ','], description: 'Open settings', category: 'navigation' },
  { keys: ['Ctrl', 'K'], description: 'Command palette', category: 'navigation' },
  { keys: ['Ctrl', 'L'], description: 'Focus input', category: 'navigation' },
];

const CATEGORY_LABELS: Record<Shortcut['category'], string> = {
  general: 'General',
  voice: 'Voice Controls',
  navigation: 'Navigation',
};

const CATEGORY_ORDER: Shortcut['category'][] = ['voice', 'navigation', 'general'];

interface KeyboardShortcutsProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
}

/**
 * Formats an Electron accelerator for display as key parts
 */
function parseAccelerator(accelerator: string): string[] {
  return accelerator
    .replace(/CommandOrControl/g, 'Ctrl')
    .replace(/CmdOrCtrl/g, 'Ctrl')
    .split('+')
    .map((key) => key.trim());
}

/**
 * Individual keyboard key badge
 */
const KeyBadge: React.FC<{ keyName: string }> = ({ keyName }) => (
  <kbd className="key-badge">{keyName}</kbd>
);

/**
 * Keyboard shortcut row
 */
const ShortcutRow: React.FC<{ shortcut: Shortcut }> = ({ shortcut }) => (
  <div className="shortcut-row cheatsheet">
    <div className="shortcut-keys">
      {shortcut.keys.map((key, index) => (
        <React.Fragment key={`${key}-${index}`}>
          <KeyBadge keyName={key} />
          {index < shortcut.keys.length - 1 && <span className="key-separator">+</span>}
        </React.Fragment>
      ))}
    </div>
    <span className="shortcut-description">{shortcut.description}</span>
  </div>
);

/**
 * Shortcut category section
 */
const ShortcutCategory: React.FC<{
  category: Shortcut['category'];
  shortcuts: Shortcut[];
}> = ({ category, shortcuts }) => (
  <div className="shortcut-category cheatsheet">
    <h4 className="category-title">{CATEGORY_LABELS[category]}</h4>
    <div className="category-shortcuts">
      {shortcuts.map((shortcut, index) => (
        <ShortcutRow key={index} shortcut={shortcut} />
      ))}
    </div>
  </div>
);

/**
 * KeyboardShortcuts - Modal displaying all available shortcuts
 *
 * @example
 * <KeyboardShortcuts isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
 */
export const KeyboardShortcuts: React.FC<KeyboardShortcutsProps> = ({ isOpen, onClose }) => {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(FALLBACK_SHORTCUTS);
  const [loading, setLoading] = useState(false);

  // Focus trap for keyboard navigation (Session 039-A)
  const modalRef = useModalFocus<HTMLDivElement>(isOpen);

  // Fetch shortcuts from API when modal opens
  useEffect(() => {
    if (!isOpen) return;

    const fetchShortcuts = async () => {
      setLoading(true);
      try {
        const result = await window.atlas?.shortcuts.getBindings();
        if (result?.success && result.data) {
          const dynamicShortcuts: Shortcut[] = result.data
            .filter((b) => !b.isHold) // Skip hold-type shortcuts for cheat sheet
            .map((binding) => ({
              keys: parseAccelerator(binding.accelerator),
              description: binding.description,
              category: getShortcutCategory(
                binding.action as Parameters<typeof getShortcutCategory>[0]
              ),
            }));

          // Add static shortcuts that aren't from API
          const staticExtras: Shortcut[] = [
            { keys: ['?'], description: 'Show keyboard shortcuts', category: 'general' },
            { keys: ['Esc'], description: 'Close current panel / Cancel', category: 'general' },
          ];

          setShortcuts([...dynamicShortcuts, ...staticExtras]);
        }
      } catch (e) {
        console.warn('[KeyboardShortcuts] Failed to fetch shortcuts, using fallback:', e);
        // Keep fallback shortcuts
      } finally {
        setLoading(false);
      }
    };

    fetchShortcuts();
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Group shortcuts by category
  const groupedShortcuts = shortcuts.reduce(
    (acc, shortcut) => {
      if (!acc[shortcut.category]) {
        acc[shortcut.category] = [];
      }
      acc[shortcut.category].push(shortcut);
      return acc;
    },
    {} as Record<Shortcut['category'], Shortcut[]>
  );

  return (
    <div className="keyboard-shortcuts-overlay" onClick={onClose} role="presentation">
      <div
        ref={modalRef}
        className="keyboard-shortcuts-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-dialog-title"
      >
        <div className="shortcuts-header">
          <h3 id="shortcuts-dialog-title" className="shortcuts-title">
            Keyboard Shortcuts
          </h3>
          <button className="shortcuts-close" onClick={onClose} aria-label="Close shortcuts dialog">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="shortcuts-content">
          {loading ? (
            <div className="shortcuts-loading">Loading shortcuts...</div>
          ) : (
            CATEGORY_ORDER.map((category) => {
              const categoryShortcuts = groupedShortcuts[category];
              if (!categoryShortcuts || categoryShortcuts.length === 0) return null;
              return (
                <ShortcutCategory
                  key={category}
                  category={category}
                  shortcuts={categoryShortcuts}
                />
              );
            })
          )}
        </div>

        <div className="shortcuts-footer">
          <span className="shortcuts-hint">
            Press <KeyBadge keyName="?" /> anytime to show this help
          </span>
        </div>
      </div>
    </div>
  );
};

/**
 * Hook to manage keyboard shortcuts modal
 */
export const useKeyboardShortcuts = () => {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  // Listen for ? key to open shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if ? is pressed (Shift + /)
      if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        // Don't trigger if user is typing in an input
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          return;
        }
        e.preventDefault();
        toggle();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle]);

  return { isOpen, open, close, toggle };
};

export default KeyboardShortcuts;
