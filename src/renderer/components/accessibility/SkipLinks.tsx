/**
 * Atlas Desktop - Skip Links Component
 * Provides keyboard-accessible skip links for navigation
 * Follows WCAG 2.1 AA guidelines for keyboard navigation
 */

import React, { useCallback, useRef, useState } from 'react';
import type { SkipLink } from '../../../shared/types/accessibility';
import { DEFAULT_SKIP_LINKS } from '../../../shared/types/accessibility';
import './SkipLinks.css';

/**
 * Props for the SkipLinks component
 */
interface SkipLinksProps {
  /**
   * Custom skip links to use instead of defaults
   */
  links?: SkipLink[];

  /**
   * Whether to show skip links
   */
  enabled?: boolean;
}

/**
 * SkipLinks Component
 *
 * Renders a list of skip links that become visible on focus.
 * These allow keyboard users to bypass navigation and jump to main content.
 */
export const SkipLinks: React.FC<SkipLinksProps> = ({
  links = DEFAULT_SKIP_LINKS,
  enabled = true,
}) => {
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Handle skip link click
   */
  const handleSkip = useCallback((targetId: string) => {
    const target = document.getElementById(targetId);
    if (target) {
      // Focus the target element
      target.focus();

      // If the target isn't focusable, make it focusable temporarily
      if (target.tabIndex < 0) {
        target.tabIndex = -1;
        target.focus();
      }

      // Scroll into view
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  /**
   * Handle key down for skip links
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, targetId: string) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleSkip(targetId);
      }
    },
    [handleSkip]
  );

  if (!enabled || links.length === 0) {
    return null;
  }

  // Sort links by order
  const sortedLinks = [...links].sort((a, b) => a.order - b.order);

  return (
    <div
      ref={containerRef}
      className={`skip-links ${focused ? 'skip-links--visible' : ''}`}
      role="navigation"
      aria-label="Skip navigation"
    >
      <ul className="skip-links__list">
        {sortedLinks.map((link) => (
          <li key={link.targetId} className="skip-links__item">
            <a
              href={`#${link.targetId}`}
              className="skip-links__link"
              onClick={(e) => {
                e.preventDefault();
                handleSkip(link.targetId);
              }}
              onKeyDown={(e) => handleKeyDown(e, link.targetId)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default SkipLinks;
