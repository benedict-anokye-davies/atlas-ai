/**
 * Atlas Desktop - Screen Reader Component
 * Provides screen reader announcements and ARIA live regions
 * Follows WCAG 2.1 AA guidelines for accessibility
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Announcement,
  AnnouncementPriority,
  AnnouncementType,
  AccessibilityEvent,
} from '../../../shared/types/accessibility';

/**
 * Props for the ScreenReader component
 */
interface ScreenReaderProps {
  /**
   * Enable screen reader announcements
   */
  enabled?: boolean;
}

/**
 * Screen reader announcement queue item
 */
interface QueuedAnnouncement extends Announcement {
  processed?: boolean;
}

/**
 * ScreenReader Component
 *
 * Manages ARIA live regions for screen reader announcements.
 * Creates hidden elements that screen readers will announce.
 *
 * Uses dual live regions:
 * - Polite: for non-urgent updates (waits for current speech to finish)
 * - Assertive: for urgent updates (interrupts current speech)
 */
export const ScreenReader: React.FC<ScreenReaderProps> = ({ enabled = true }) => {
  const [politeAnnouncement, setPoliteAnnouncement] = useState<string>('');
  const [assertiveAnnouncement, setAssertiveAnnouncement] = useState<string>('');
  const [announcementQueue, setAnnouncementQueue] = useState<QueuedAnnouncement[]>([]);
  const processingRef = useRef(false);
  const clearTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Clear announcements after they've been read
   */
  const clearAnnouncements = useCallback(() => {
    if (clearTimeoutRef.current) {
      clearTimeout(clearTimeoutRef.current);
    }
    clearTimeoutRef.current = setTimeout(() => {
      setPoliteAnnouncement('');
      setAssertiveAnnouncement('');
    }, 1000);
  }, []);

  /**
   * Process an announcement
   */
  const processAnnouncement = useCallback(
    (announcement: Announcement) => {
      if (!enabled) return;

      // Set the announcement in the appropriate live region
      if (announcement.priority === 'assertive') {
        setAssertiveAnnouncement(announcement.message);
      } else {
        setPoliteAnnouncement(announcement.message);
      }

      // Clear after announcement is likely to have been read
      clearAnnouncements();
    },
    [enabled, clearAnnouncements]
  );

  /**
   * Process the announcement queue
   */
  const processQueue = useCallback(() => {
    if (processingRef.current || announcementQueue.length === 0) {
      return;
    }

    processingRef.current = true;
    const [current, ...rest] = announcementQueue;

    processAnnouncement(current);
    setAnnouncementQueue(rest);

    // Process next announcement after a delay to allow current one to be read
    setTimeout(() => {
      processingRef.current = false;
      processQueue();
    }, 200);
  }, [announcementQueue, processAnnouncement]);

  /**
   * Add announcement to queue
   */
  const queueAnnouncement = useCallback((announcement: Announcement) => {
    if (announcement.priority === 'assertive') {
      // Assertive announcements clear the queue and announce immediately
      setAnnouncementQueue([announcement]);
    } else {
      setAnnouncementQueue((prev) => [...prev, announcement]);
    }
  }, []);

  /**
   * Listen for accessibility events from main process
   */
  useEffect(() => {
    const handleAccessibilityEvent = (event: AccessibilityEvent) => {
      if (event.type === 'announcement') {
        const announcement = event.data as Announcement;
        queueAnnouncement(announcement);
      }
    };

    const unsubscribe = window.atlas?.on(
      'atlas:accessibility',
      handleAccessibilityEvent as (...args: unknown[]) => void
    );

    return () => {
      unsubscribe?.();
    };
  }, [queueAnnouncement]);

  /**
   * Process queue when it changes
   */
  useEffect(() => {
    processQueue();
  }, [announcementQueue, processQueue]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (clearTimeoutRef.current) {
        clearTimeout(clearTimeoutRef.current);
      }
    };
  }, []);

  if (!enabled) {
    return null;
  }

  return (
    <>
      {/* Polite live region - waits for current speech to finish */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          padding: 0,
          margin: '-1px',
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {politeAnnouncement}
      </div>

      {/* Assertive live region - interrupts current speech */}
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          padding: 0,
          margin: '-1px',
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {assertiveAnnouncement}
      </div>
    </>
  );
};

/**
 * Hook for making announcements from components
 */
export function useAnnounce() {
  const announce = useCallback(
    (
      message: string,
      priority: AnnouncementPriority = 'polite',
      type: AnnouncementType = 'info'
    ) => {
      // Create announcement event and dispatch to IPC
      const announcement: Announcement = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        message,
        priority,
        type,
        timestamp: Date.now(),
      };

      // Dispatch custom event for local handling
      window.dispatchEvent(
        new CustomEvent('atlas:announce', { detail: announcement })
      );
    },
    []
  );

  return { announce };
}

/**
 * ScreenReaderAnnouncer - Simpler component for local announcements
 */
export const ScreenReaderAnnouncer: React.FC = () => {
  const [politeMessage, setPoliteMessage] = useState('');
  const [assertiveMessage, setAssertiveMessage] = useState('');

  useEffect(() => {
    const handleAnnounce = (event: CustomEvent<Announcement>) => {
      const { message, priority } = event.detail;
      if (priority === 'assertive') {
        setAssertiveMessage('');
        // Force re-render by clearing first
        setTimeout(() => setAssertiveMessage(message), 10);
      } else {
        setPoliteMessage('');
        setTimeout(() => setPoliteMessage(message), 10);
      }

      // Clear after announcement
      setTimeout(() => {
        setPoliteMessage('');
        setAssertiveMessage('');
      }, 3000);
    };

    window.addEventListener('atlas:announce', handleAnnounce as EventListener);
    return () => {
      window.removeEventListener('atlas:announce', handleAnnounce as EventListener);
    };
  }, []);

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        style={srOnlyStyle}
      >
        {politeMessage}
      </div>
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
        style={srOnlyStyle}
      >
        {assertiveMessage}
      </div>
    </>
  );
};

/**
 * Screen reader only styles
 */
const srOnlyStyle: React.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export default ScreenReader;
