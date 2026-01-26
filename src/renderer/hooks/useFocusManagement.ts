/**
 * Atlas Desktop - Focus Management Hooks
 * Keyboard navigation accessibility utilities
 *
 * Session 039-A: Keyboard Navigation
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Focusable element selectors
 */
const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable]',
].join(', ');

/**
 * Get all focusable elements within a container
 */
function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)).filter(
    (el) => !el.hasAttribute('disabled') && el.offsetParent !== null
  );
}

/**
 * useFocusTrap - Trap focus within a container element
 *
 * When active, Tab and Shift+Tab will cycle through focusable elements
 * within the container without escaping.
 *
 * @example
 * const { containerRef, activate, deactivate } = useFocusTrap();
 * return <div ref={containerRef}>...</div>
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>() {
  const containerRef = useRef<T>(null);
  const [isActive, setIsActive] = useState(false);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!isActive || !containerRef.current) return;
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements(containerRef.current);
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement as HTMLElement;

      // Shift+Tab from first element -> go to last
      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }

      // Tab from last element -> go to first
      if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
        return;
      }

      // If focus is outside container, bring it back
      if (!containerRef.current.contains(activeElement)) {
        event.preventDefault();
        firstElement.focus();
      }
    },
    [isActive]
  );

  useEffect(() => {
    if (isActive) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
    return undefined;
  }, [isActive, handleKeyDown]);

  const activate = useCallback(() => {
    setIsActive(true);
    // Focus first focusable element when activating
    requestAnimationFrame(() => {
      const elements = getFocusableElements(containerRef.current);
      if (elements.length > 0) {
        elements[0].focus();
      }
    });
  }, []);

  const deactivate = useCallback(() => {
    setIsActive(false);
  }, []);

  return {
    containerRef,
    isActive,
    activate,
    deactivate,
  };
}

/**
 * useFocusRestore - Restore focus to a previously focused element
 *
 * Stores the currently focused element when activated and restores
 * focus to it when deactivated.
 *
 * @example
 * const { save, restore } = useFocusRestore();
 * useEffect(() => { if (isOpen) save(); else restore(); }, [isOpen]);
 */
export function useFocusRestore() {
  const previousActiveElement = useRef<HTMLElement | null>(null);

  const save = useCallback(() => {
    previousActiveElement.current = document.activeElement as HTMLElement;
  }, []);

  const restore = useCallback(() => {
    if (previousActiveElement.current && previousActiveElement.current.focus) {
      previousActiveElement.current.focus();
      previousActiveElement.current = null;
    }
  }, []);

  return { save, restore };
}

/**
 * useFocusOnMount - Focus an element when component mounts
 *
 * @example
 * const inputRef = useFocusOnMount<HTMLInputElement>();
 * return <input ref={inputRef} />;
 */
export function useFocusOnMount<T extends HTMLElement = HTMLElement>() {
  const elementRef = useRef<T>(null);

  useEffect(() => {
    if (elementRef.current) {
      elementRef.current.focus();
    }
  }, []);

  return elementRef;
}

/**
 * Roving tab index direction
 */
export type RovingDirection = 'horizontal' | 'vertical' | 'both';

/**
 * useRovingTabIndex - Arrow key navigation for lists/grids
 *
 * Implements the roving tabindex pattern where only one element
 * in a group is tabbable and arrow keys move focus between items.
 *
 * @param options Configuration options
 * @returns Container ref and current focused index
 *
 * @example
 * const { containerRef, focusedIndex, setFocusedIndex } = useRovingTabIndex({
 *   itemCount: items.length,
 *   direction: 'vertical'
 * });
 */
export function useRovingTabIndex<T extends HTMLElement = HTMLDivElement>(options: {
  itemCount: number;
  direction?: RovingDirection;
  loop?: boolean;
  onSelect?: (index: number) => void;
  initialIndex?: number;
}) {
  const { itemCount, direction = 'vertical', loop = true, onSelect, initialIndex = 0 } = options;

  const containerRef = useRef<T>(null);
  const [focusedIndex, setFocusedIndex] = useState(initialIndex);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) return;

      const isHorizontal = direction === 'horizontal' || direction === 'both';
      const isVertical = direction === 'vertical' || direction === 'both';

      let nextIndex = focusedIndex;

      switch (event.key) {
        case 'ArrowUp':
          if (isVertical) {
            event.preventDefault();
            nextIndex = focusedIndex - 1;
            if (nextIndex < 0) nextIndex = loop ? itemCount - 1 : 0;
          }
          break;

        case 'ArrowDown':
          if (isVertical) {
            event.preventDefault();
            nextIndex = focusedIndex + 1;
            if (nextIndex >= itemCount) nextIndex = loop ? 0 : itemCount - 1;
          }
          break;

        case 'ArrowLeft':
          if (isHorizontal) {
            event.preventDefault();
            nextIndex = focusedIndex - 1;
            if (nextIndex < 0) nextIndex = loop ? itemCount - 1 : 0;
          }
          break;

        case 'ArrowRight':
          if (isHorizontal) {
            event.preventDefault();
            nextIndex = focusedIndex + 1;
            if (nextIndex >= itemCount) nextIndex = loop ? 0 : itemCount - 1;
          }
          break;

        case 'Home':
          event.preventDefault();
          nextIndex = 0;
          break;

        case 'End':
          event.preventDefault();
          nextIndex = itemCount - 1;
          break;

        case 'Enter':
        case ' ':
          event.preventDefault();
          onSelect?.(focusedIndex);
          return;

        default:
          return;
      }

      if (nextIndex !== focusedIndex) {
        setFocusedIndex(nextIndex);

        // Focus the element at the new index
        const focusableElements = getFocusableElements(containerRef.current);
        if (focusableElements[nextIndex]) {
          focusableElements[nextIndex].focus();
        }
      }
    },
    [focusedIndex, itemCount, direction, loop, onSelect]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return {
    containerRef,
    focusedIndex,
    setFocusedIndex,
    getItemProps: (index: number) => ({
      tabIndex: index === focusedIndex ? 0 : -1,
      'aria-selected': index === focusedIndex,
      onFocus: () => setFocusedIndex(index),
    }),
  };
}

/**
 * useEscapeKey - Handle Escape key press
 *
 * @param onEscape Callback when Escape is pressed
 * @param enabled Whether the listener is active
 */
export function useEscapeKey(onEscape: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscape();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onEscape, enabled]);
}

/**
 * useArrowNavigation - Simple arrow key navigation for parent/child focus
 *
 * @param onNavigate Callback with direction ('up' | 'down' | 'left' | 'right')
 * @param enabled Whether the listener is active
 */
export function useArrowNavigation(
  onNavigate: (direction: 'up' | 'down' | 'left' | 'right') => void,
  enabled = true
) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't navigate if typing in an input
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault();
          onNavigate('up');
          break;
        case 'ArrowDown':
          event.preventDefault();
          onNavigate('down');
          break;
        case 'ArrowLeft':
          event.preventDefault();
          onNavigate('left');
          break;
        case 'ArrowRight':
          event.preventDefault();
          onNavigate('right');
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onNavigate, enabled]);
}

/**
 * useModalFocus - Combined focus trap and restore for modals
 *
 * @param isOpen Whether the modal is open
 * @returns Container ref for the modal
 */
export function useModalFocus<T extends HTMLElement = HTMLDivElement>(isOpen: boolean) {
  const { containerRef, activate, deactivate } = useFocusTrap<T>();
  const { save, restore } = useFocusRestore();

  useEffect(() => {
    if (isOpen) {
      save();
      activate();
    } else {
      deactivate();
      restore();
    }
  }, [isOpen, save, restore, activate, deactivate]);

  return containerRef;
}

export default {
  useFocusTrap,
  useFocusRestore,
  useFocusOnMount,
  useRovingTabIndex,
  useEscapeKey,
  useArrowNavigation,
  useModalFocus,
};
