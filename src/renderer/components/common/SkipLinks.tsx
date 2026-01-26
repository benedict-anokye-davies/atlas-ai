/**
 * Atlas Desktop - Skip Links Component
 * Accessibility navigation for keyboard and screen reader users
 *
 * Session 039-A: Keyboard Navigation
 */

import React from 'react';
import './SkipLinks.css';

/**
 * Skip link configuration
 */
export interface SkipLink {
  /** Unique identifier for the skip link */
  id: string;
  /** Display text for the link */
  label: string;
  /** Target element ID or ref */
  target: string;
}

/**
 * Default skip links for Atlas
 */
export const DEFAULT_SKIP_LINKS: SkipLink[] = [
  { id: 'skip-main', label: 'Skip to main content', target: 'main-content' },
  { id: 'skip-orb', label: 'Skip to orb', target: 'atlas-orb' },
  { id: 'skip-controls', label: 'Skip to controls', target: 'footer-controls' },
];

interface SkipLinksProps {
  /** Custom skip links (uses defaults if not provided) */
  links?: SkipLink[];
}

/**
 * SkipLinks - Hidden links that appear on focus for keyboard navigation
 *
 * These links are visually hidden but become visible when focused,
 * allowing keyboard users to quickly jump to main areas of the app.
 *
 * @example
 * // In App.tsx
 * <SkipLinks />
 * <main id="main-content">...</main>
 */
export const SkipLinks: React.FC<SkipLinksProps> = ({ links = DEFAULT_SKIP_LINKS }) => {
  const handleClick = (target: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    const element = document.getElementById(target);
    if (element) {
      element.focus();
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleKeyDown = (target: string) => (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const element = document.getElementById(target);
      if (element) {
        element.focus();
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  return (
    <nav className="skip-links" aria-label="Skip navigation">
      {links.map((link) => (
        <a
          key={link.id}
          href={`#${link.target}`}
          className="skip-link"
          onClick={handleClick(link.target)}
          onKeyDown={handleKeyDown(link.target)}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
};

/**
 * SkipTarget - Invisible focus target for skip links
 *
 * Add this component where you want skip links to jump to.
 * The element will receive focus but remain invisible.
 *
 * @example
 * <SkipTarget id="main-content" />
 * <main>...</main>
 */
export const SkipTarget: React.FC<{
  id: string;
  label?: string;
}> = ({ id, label }) => (
  <div
    id={id}
    tabIndex={-1}
    className="skip-target"
    aria-label={label}
    role="region"
  />
);

export default SkipLinks;
