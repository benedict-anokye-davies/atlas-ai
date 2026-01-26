/**
 * Atlas Desktop - Accessibility Components
 * Export all accessibility components and hooks
 */

export { ScreenReader, ScreenReaderAnnouncer, useAnnounce } from './ScreenReader';
export { SkipLinks } from './SkipLinks';
export { FocusTrap, useFocusTrap } from './FocusTrap';
export {
  AccessibilityProvider,
  useAccessibility,
  usePrefersReducedMotion,
  useHighContrast,
} from './AccessibilityProvider';

// Import accessibility styles
import './Accessibility.css';
import './SkipLinks.css';
