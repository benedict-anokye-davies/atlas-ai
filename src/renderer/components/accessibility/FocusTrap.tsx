/**
 * Atlas Desktop - Focus Trap Component
 * Traps keyboard focus within a container for modal dialogs
 * Follows WCAG 2.1 AA guidelines for focus management
 */

import React, { useCallback, useEffect, useRef } from 'react';

/**
 * Get all focusable elements within a container
 */
function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const focusableSelectors = [
    'a[href]:not([disabled]):not([tabindex="-1"])',
    'button:not([disabled]):not([tabindex="-1"])',
    'input:not([disabled]):not([tabindex="-1"])',
    'select:not([disabled]):not([tabindex="-1"])',
    'textarea:not([disabled]):not([tabindex="-1"])',
    '[tabindex]:not([tabindex="-1"]):not([disabled])',
    '[contenteditable="true"]:not([disabled])',
  ];

  const elements = container.querySelectorAll<HTMLElement>(
    focusableSelectors.join(', ')
  );

  return Array.from(elements).filter(
    (el) => el.offsetParent !== null // Filter out hidden elements
  );
}

/**
 * Props for the FocusTrap component
 */
interface FocusTrapProps {
  /**
   * Children to render within the focus trap
   */
  children: React.ReactNode;

  /**
   * Whether the focus trap is active
   */
  active?: boolean;

  /**
   * Initial focus target selector (optional)
   */
  initialFocus?: string;

  /**
   * Element to return focus to when trap is deactivated
   */
  returnFocus?: HTMLElement | null;

  /**
   * Allow escape key to deactivate the trap
   */
  escapeDeactivates?: boolean;

  /**
   * Callback when escape is pressed (if escapeDeactivates is true)
   */
  onEscape?: () => void;

  /**
   * Click outside to deactivate
   */
  clickOutsideDeactivates?: boolean;

  /**
   * Callback when clicking outside (if clickOutsideDeactivates is true)
   */
  onClickOutside?: () => void;

  /**
   * Additional class name for the container
   */
  className?: string;

  /**
   * Role for the container
   */
  role?: string;

  /**
   * Aria label for the container
   */
  ariaLabel?: string;
}

/**
 * FocusTrap Component
 *
 * Traps focus within a container, useful for modal dialogs.
 * Ensures keyboard users can navigate only within the trapped area.
 */
export const FocusTrap: React.FC<FocusTrapProps> = ({
  children,
  active = true,
  initialFocus,
  returnFocus,
  escapeDeactivates = true,
  onEscape,
  clickOutsideDeactivates = false,
  onClickOutside,
  className,
  role = 'dialog',
  ariaLabel,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  /**
   * Set initial focus when trap activates
   */
  useEffect(() => {
    if (!active || !containerRef.current) return;

    // Store currently focused element
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Focus initial element or first focusable
    const container = containerRef.current;
    let focusTarget: HTMLElement | null = null;

    if (initialFocus) {
      focusTarget = container.querySelector(initialFocus);
    }

    if (!focusTarget) {
      const focusableElements = getFocusableElements(container);
      focusTarget = focusableElements[0] || container;
    }

    // Delay focus to ensure element is ready
    requestAnimationFrame(() => {
      focusTarget?.focus();
    });

    // Return focus when deactivated
    return () => {
      const elementToFocus = returnFocus || previousFocusRef.current;
      if (elementToFocus && document.body.contains(elementToFocus)) {
        elementToFocus.focus();
      }
    };
  }, [active, initialFocus, returnFocus]);

  /**
   * Handle keyboard events for focus trapping
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!active || !containerRef.current) return;

      // Handle Escape key
      if (event.key === 'Escape' && escapeDeactivates) {
        event.preventDefault();
        event.stopPropagation();
        onEscape?.();
        return;
      }

      // Handle Tab key for focus trapping
      if (event.key === 'Tab') {
        const focusableElements = getFocusableElements(containerRef.current);
        if (focusableElements.length === 0) {
          event.preventDefault();
          return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        // Shift+Tab on first element -> go to last
        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
          return;
        }

        // Tab on last element -> go to first
        if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
          return;
        }
      }
    },
    [active, escapeDeactivates, onEscape]
  );

  /**
   * Handle click outside
   */
  useEffect(() => {
    if (!active || !clickOutsideDeactivates || !containerRef.current) return;

    const handleClick = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        onClickOutside?.();
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
    };
  }, [active, clickOutsideDeactivates, onClickOutside]);

  return (
    <div
      ref={containerRef}
      className={className}
      role={role}
      aria-label={ariaLabel}
      aria-modal={active ? 'true' : undefined}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {children}
    </div>
  );
};

/**
 * Hook for managing focus trap programmatically
 */
export function useFocusTrap(options: {
  containerId?: string;
  active?: boolean;
  initialFocus?: string;
  returnFocus?: HTMLElement | null;
}) {
  const { containerId, active = false, initialFocus, returnFocus } = options;
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active || !containerId) return;

    const container = document.getElementById(containerId);
    if (!container) return;

    // Store current focus
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Set initial focus
    let focusTarget: HTMLElement | null = null;
    if (initialFocus) {
      focusTarget = container.querySelector(initialFocus);
    }
    if (!focusTarget) {
      const focusable = getFocusableElements(container);
      focusTarget = focusable[0] || container;
    }
    focusTarget?.focus();

    // Handle Tab key
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements(container);
      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    container.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      const elementToFocus = returnFocus || previousFocusRef.current;
      if (elementToFocus && document.body.contains(elementToFocus)) {
        elementToFocus.focus();
      }
    };
  }, [active, containerId, initialFocus, returnFocus]);
}

export default FocusTrap;
