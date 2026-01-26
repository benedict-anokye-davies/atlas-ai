/**
 * Atlas Desktop - useShortcuts Hook
 * Local keyboard shortcut handling for the renderer process
 */

import { useEffect, useCallback, useRef, useState } from 'react';

// ============================================================================
// Types
// ============================================================================

/**
 * Shortcut action identifiers (must match main process)
 */
export type ShortcutAction =
  | 'push-to-talk'
  | 'toggle-window'
  | 'toggle-mute'
  | 'open-settings'
  | 'cancel-action'
  | 'command-palette'
  | 'focus-input'
  | 'clear-conversation';

/**
 * Shortcut definition from main process
 */
export interface ShortcutDefinition {
  action: ShortcutAction;
  accelerator: string;
  description: string;
}

/**
 * Parsed key combination
 */
interface ParsedAccelerator {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
}

/**
 * Shortcut handler callback
 */
export type ShortcutHandler = (action: ShortcutAction) => void;

/**
 * Hook options
 */
export interface UseShortcutsOptions {
  /** Custom handlers for specific actions */
  handlers?: Partial<Record<ShortcutAction, () => void>>;
  /** Whether shortcuts are enabled */
  enabled?: boolean;
  /** Callback when any shortcut is triggered */
  onShortcut?: ShortcutHandler;
}

/**
 * Hook return value
 */
export interface UseShortcutsReturn {
  /** Currently registered shortcuts */
  shortcuts: ShortcutDefinition[];
  /** Whether shortcuts are active */
  isActive: boolean;
  /** Register a handler for an action */
  registerHandler: (action: ShortcutAction, handler: () => void) => void;
  /** Unregister a handler for an action */
  unregisterHandler: (action: ShortcutAction) => void;
  /** Trigger a shortcut action programmatically */
  triggerAction: (action: ShortcutAction) => void;
}

// ============================================================================
// Accelerator Parsing
// ============================================================================

/**
 * Parse an Electron accelerator string into key components
 */
function parseAccelerator(accelerator: string): ParsedAccelerator {
  const parts = accelerator.split('+').map((p) => p.trim().toLowerCase());
  const isMac = navigator.platform.toLowerCase().includes('mac');

  const result: ParsedAccelerator = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    key: '',
  };

  for (const part of parts) {
    switch (part) {
      case 'commandorcontrol':
      case 'cmdorctrl':
        // On Mac, use meta (Cmd), on others use ctrl
        if (isMac) {
          result.meta = true;
        } else {
          result.ctrl = true;
        }
        break;
      case 'command':
      case 'cmd':
      case 'super':
        result.meta = true;
        break;
      case 'control':
      case 'ctrl':
        result.ctrl = true;
        break;
      case 'shift':
        result.shift = true;
        break;
      case 'alt':
      case 'option':
        result.alt = true;
        break;
      case 'escape':
      case 'esc':
        result.key = 'Escape';
        break;
      case 'delete':
        result.key = 'Delete';
        break;
      case 'backspace':
        result.key = 'Backspace';
        break;
      case 'space':
        result.key = ' ';
        break;
      case 'enter':
      case 'return':
        result.key = 'Enter';
        break;
      case 'tab':
        result.key = 'Tab';
        break;
      default:
        // Single character keys
        result.key = part.length === 1 ? part : part.charAt(0).toUpperCase() + part.slice(1);
    }
  }

  return result;
}

/**
 * Check if a keyboard event matches a parsed accelerator
 */
function matchesAccelerator(event: KeyboardEvent, parsed: ParsedAccelerator): boolean {
  // Check modifiers
  if (parsed.ctrl !== event.ctrlKey) return false;
  if (parsed.shift !== event.shiftKey) return false;
  if (parsed.alt !== event.altKey) return false;
  if (parsed.meta !== event.metaKey) return false;

  // Check key
  const eventKey = event.key.toLowerCase();
  const parsedKey = parsed.key.toLowerCase();

  if (eventKey === parsedKey) return true;

  // Handle special cases
  if (parsedKey === ' ' && event.code === 'Space') return true;
  if (parsedKey === ',' && eventKey === ',') return true;

  return false;
}

// ============================================================================
// Default Handlers
// ============================================================================

/**
 * Default action handlers that can be overridden
 */
const defaultHandlers: Partial<Record<ShortcutAction, () => void>> = {
  'cancel-action': () => {
    // Clear focus from current element
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    // Trigger escape event
    document.dispatchEvent(new CustomEvent('atlas:cancel'));
  },
};

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for handling local keyboard shortcuts
 */
export function useShortcuts(options: UseShortcutsOptions = {}): UseShortcutsReturn {
  const { handlers: customHandlers = {}, enabled = true, onShortcut } = options;

  // State
  const [shortcuts, setShortcuts] = useState<ShortcutDefinition[]>([]);
  const [isActive, setIsActive] = useState(false);

  // Refs for stable callback references
  const handlersRef = useRef<Partial<Record<ShortcutAction, () => void>>>({
    ...defaultHandlers,
    ...customHandlers,
  });
  const shortcutsRef = useRef<ShortcutDefinition[]>([]);
  const parsedShortcutsRef = useRef<Map<string, { parsed: ParsedAccelerator; action: ShortcutAction }>>(
    new Map()
  );

  // Update handlers ref when customHandlers change
  useEffect(() => {
    handlersRef.current = { ...defaultHandlers, ...customHandlers };
  }, [customHandlers]);

  // Listen for shortcut configuration from main process
  useEffect(() => {
    if (!window.atlas) return;

    const cleanup = window.atlas.on('atlas:shortcuts-config', (data: unknown) => {
      const { shortcuts: newShortcuts } = data as { shortcuts: ShortcutDefinition[] };
      setShortcuts(newShortcuts);
      shortcutsRef.current = newShortcuts;

      // Pre-parse all accelerators for faster matching
      parsedShortcutsRef.current.clear();
      for (const shortcut of newShortcuts) {
        try {
          const parsed = parseAccelerator(shortcut.accelerator);
          parsedShortcutsRef.current.set(shortcut.action, { parsed, action: shortcut.action });
        } catch (error) {
          console.warn(`Failed to parse accelerator for ${shortcut.action}:`, error);
        }
      }

      setIsActive(true);
    });

    return cleanup;
  }, []);

  // Listen for shortcut triggers from main process (global shortcuts)
  useEffect(() => {
    if (!window.atlas) return;

    const cleanup = window.atlas.on('atlas:shortcut', (data: unknown) => {
      const { action } = data as { action: ShortcutAction };
      // Call handler directly to avoid dependency on triggerAction
      const handler = handlersRef.current[action];
      if (handler) {
        handler();
      }
      if (onShortcut) {
        onShortcut(action);
      }
    });

    return cleanup;
  }, [onShortcut]);

  // Keyboard event handler
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Don't handle shortcuts when typing in inputs (except Escape)
      const target = event.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // Check each shortcut
      for (const [, { parsed, action }] of parsedShortcutsRef.current) {
        if (matchesAccelerator(event, parsed)) {
          // Allow Escape even in inputs
          if (isInput && action !== 'cancel-action') {
            continue;
          }

          event.preventDefault();
          event.stopPropagation();

          // Call handler
          const handler = handlersRef.current[action];
          if (handler) {
            handler();
          }

          // Notify callback
          if (onShortcut) {
            onShortcut(action);
          }

          return;
        }
      }
    },
    [enabled, onShortcut]
  );

  // Setup keyboard listener
  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [enabled, handleKeyDown]);

  // Register a handler for an action
  const registerHandler = useCallback((action: ShortcutAction, handler: () => void) => {
    handlersRef.current[action] = handler;
  }, []);

  // Unregister a handler for an action
  const unregisterHandler = useCallback((action: ShortcutAction) => {
    delete handlersRef.current[action];
  }, []);

  // Trigger an action programmatically
  const triggerAction = useCallback((action: ShortcutAction) => {
    const handler = handlersRef.current[action];
    if (handler) {
      handler();
    }
    if (onShortcut) {
      onShortcut(action);
    }
  }, [onShortcut]);

  return {
    shortcuts,
    isActive,
    registerHandler,
    unregisterHandler,
    triggerAction,
  };
}

/**
 * Hook for push-to-talk functionality
 * Handles key-down/key-up for hold-to-speak
 */
export function usePushToTalk(options: {
  onStart?: () => void;
  onEnd?: () => void;
  accelerator?: string;
  enabled?: boolean;
}): { isActive: boolean } {
  const { onStart, onEnd, accelerator = 'CommandOrControl+Space', enabled = true } = options;

  const [isActive, setIsActive] = useState(false);
  const parsedRef = useRef<ParsedAccelerator | null>(null);

  // Parse accelerator
  useEffect(() => {
    try {
      parsedRef.current = parseAccelerator(accelerator);
    } catch (error) {
      console.warn('Failed to parse push-to-talk accelerator:', error);
    }
  }, [accelerator]);

  // Handle key down
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled || !parsedRef.current) return;
      if (event.repeat) return; // Ignore key repeat

      if (matchesAccelerator(event, parsedRef.current)) {
        event.preventDefault();
        if (!isActive) {
          setIsActive(true);
          onStart?.();
        }
      }
    },
    [enabled, isActive, onStart]
  );

  // Handle key up
  const handleKeyUp = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled || !parsedRef.current) return;

      // Check if released key was part of the accelerator
      if (matchesAccelerator(event, parsedRef.current) || isActive) {
        // Check if all modifier keys are released
        const parsed = parsedRef.current;
        const modifiersReleased =
          (!parsed.ctrl || !event.ctrlKey) &&
          (!parsed.meta || !event.metaKey) &&
          (!parsed.shift || !event.shiftKey) &&
          (!parsed.alt || !event.altKey);

        if (modifiersReleased || event.key.toLowerCase() === parsed.key.toLowerCase()) {
          setIsActive(false);
          onEnd?.();
        }
      }
    },
    [enabled, isActive, onEnd]
  );

  // Setup listeners
  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp, { capture: true });

    // Also end on window blur
    const handleBlur = () => {
      if (isActive) {
        setIsActive(false);
        onEnd?.();
      }
    };
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('keyup', handleKeyUp, { capture: true });
      window.removeEventListener('blur', handleBlur);
    };
  }, [enabled, handleKeyDown, handleKeyUp, isActive, onEnd]);

  return { isActive };
}

export default useShortcuts;
