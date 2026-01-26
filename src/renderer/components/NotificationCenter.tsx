/**
 * Atlas Desktop - Notification Center Component
 * Toast notifications and notification history panel
 */

import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useNotificationStore } from '../stores/notificationStore';
import type { Notification, NotificationType } from '../../shared/types/notification';

// ============================================================================
// Icons
// ============================================================================

const InfoIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

const SuccessIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const WarningIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const ErrorIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);

const CloseIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
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
);

const BellIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const TrashIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

// ============================================================================
// Type Styling
// ============================================================================

const typeStyles: Record<NotificationType, { bg: string; border: string; icon: string; text: string }> = {
  info: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    icon: 'text-blue-400',
    text: 'text-blue-200',
  },
  success: {
    bg: 'bg-green-500/10',
    border: 'border-green-500/30',
    icon: 'text-green-400',
    text: 'text-green-200',
  },
  warning: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    icon: 'text-amber-400',
    text: 'text-amber-200',
  },
  error: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    icon: 'text-red-400',
    text: 'text-red-200',
  },
};

const getIcon = (type: NotificationType): React.FC<{ className?: string }> => {
  switch (type) {
    case 'success':
      return SuccessIcon;
    case 'warning':
      return WarningIcon;
    case 'error':
      return ErrorIcon;
    case 'info':
    default:
      return InfoIcon;
  }
};

// ============================================================================
// Toast Component
// ============================================================================

interface ToastProps {
  notification: Notification;
  onDismiss: () => void;
  onAction: (actionId: string) => void;
}

const Toast: React.FC<ToastProps> = ({ notification, onDismiss, onAction }) => {
  const [isExiting, setIsExiting] = useState(false);
  const [progress, setProgress] = useState(100);
  const progressRef = useRef<NodeJS.Timeout | null>(null);

  const styles = typeStyles[notification.type];
  const IconComponent = getIcon(notification.type);

  // Handle progress bar for auto-dismiss
  useEffect(() => {
    if (notification.timeout > 0) {
      const startTime = Date.now();
      const updateProgress = () => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, 100 - (elapsed / notification.timeout) * 100);
        setProgress(remaining);

        if (remaining > 0) {
          progressRef.current = setTimeout(updateProgress, 50);
        }
      };
      updateProgress();
    }

    return () => {
      if (progressRef.current) {
        clearTimeout(progressRef.current);
      }
    };
  }, [notification.timeout]);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(onDismiss, 200);
  }, [onDismiss]);

  return (
    <div
      className={`
        relative overflow-hidden
        max-w-sm w-full
        ${styles.bg} ${styles.border}
        border rounded-lg shadow-lg
        backdrop-blur-md
        transform transition-all duration-200 ease-out
        ${isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'}
      `}
      role="alert"
      aria-live={notification.priority === 'urgent' ? 'assertive' : 'polite'}
    >
      {/* Progress bar */}
      {notification.timeout > 0 && (
        <div
          className={`absolute bottom-0 left-0 h-0.5 ${styles.icon} bg-current opacity-50 transition-all duration-50`}
          style={{ width: `${progress}%` }}
        />
      )}

      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className={`flex-shrink-0 ${styles.icon}`}>
            <IconComponent className="w-5 h-5" />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <h4 className={`text-sm font-medium ${styles.text}`}>{notification.title}</h4>
            {notification.message && (
              <p className="mt-1 text-sm text-gray-400 line-clamp-2">{notification.message}</p>
            )}

            {/* Actions */}
            {notification.actions && notification.actions.length > 0 && (
              <div className="mt-3 flex gap-2">
                {notification.actions.map((action) => (
                  <button
                    key={action.id}
                    onClick={() => onAction(action.id)}
                    className={`
                      px-3 py-1.5 text-xs font-medium rounded
                      transition-colors duration-150
                      ${
                        action.primary
                          ? `${styles.bg} ${styles.text} hover:opacity-80`
                          : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                      }
                    `}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Close button */}
          {notification.dismissible && (
            <button
              onClick={handleDismiss}
              className="flex-shrink-0 p-1 text-gray-500 hover:text-gray-300 rounded transition-colors"
              aria-label="Dismiss notification"
            >
              <CloseIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Toast Container
// ============================================================================

const ToastContainer: React.FC = () => {
  const getVisibleToasts = useNotificationStore((state) => state.getVisibleToasts);
  const dismissNotification = useNotificationStore((state) => state.dismissNotification);
  const triggerAction = useNotificationStore((state) => state.triggerAction);
  const settings = useNotificationStore((state) => state.settings);

  const visibleToasts = getVisibleToasts();

  // Position classes based on settings
  const positionClasses: Record<string, string> = {
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4',
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'top-center': 'top-4 left-1/2 -translate-x-1/2',
    'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2',
  };

  return (
    <div
      className={`fixed z-50 ${positionClasses[settings.toastPosition]} flex flex-col gap-2`}
      aria-label="Notifications"
    >
      {visibleToasts.map((notification) => (
        <Toast
          key={notification.id}
          notification={notification}
          onDismiss={() => dismissNotification(notification.id)}
          onAction={(actionId) => triggerAction(notification.id, actionId)}
        />
      ))}
    </div>
  );
};

// ============================================================================
// History Panel
// ============================================================================

const HistoryPanel: React.FC = () => {
  const notifications = useNotificationStore((state) => state.notifications);
  const isHistoryOpen = useNotificationStore((state) => state.isHistoryOpen);
  const setHistoryOpen = useNotificationStore((state) => state.setHistoryOpen);
  const dismissNotification = useNotificationStore((state) => state.dismissNotification);
  const dismissAllNotifications = useNotificationStore((state) => state.dismissAllNotifications);
  const markAsRead = useNotificationStore((state) => state.markAsRead);
  const markAllAsRead = useNotificationStore((state) => state.markAllAsRead);
  const triggerAction = useNotificationStore((state) => state.triggerAction);

  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setHistoryOpen(false);
      }
    };

    if (isHistoryOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isHistoryOpen, setHistoryOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isHistoryOpen) {
        setHistoryOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isHistoryOpen, setHistoryOpen]);

  // Mark as read when viewing
  useEffect(() => {
    if (isHistoryOpen) {
      const timer = setTimeout(() => {
        markAllAsRead();
      }, 1000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isHistoryOpen, markAllAsRead]);

  const formatTime = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) {
      return 'Just now';
    } else if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return `${minutes}m ago`;
    } else if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    } else {
      return new Date(timestamp).toLocaleDateString();
    }
  };

  if (!isHistoryOpen) return null;

  return (
    <div
      ref={panelRef}
      className="fixed top-4 right-4 z-50 w-96 max-h-[80vh] bg-gray-900/95 backdrop-blur-md border border-gray-700/50 rounded-lg shadow-2xl overflow-hidden"
      role="dialog"
      aria-label="Notification History"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700/50">
        <h2 className="text-lg font-semibold text-white">Notifications</h2>
        <div className="flex items-center gap-2">
          {notifications.length > 0 && (
            <button
              onClick={dismissAllNotifications}
              className="p-1.5 text-gray-400 hover:text-red-400 rounded transition-colors"
              title="Clear all"
            >
              <TrashIcon className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setHistoryOpen(false)}
            className="p-1.5 text-gray-400 hover:text-white rounded transition-colors"
            aria-label="Close"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Notification list */}
      <div className="overflow-y-auto max-h-[calc(80vh-60px)]">
        {notifications.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <BellIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No notifications</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-700/30">
            {notifications.map((notification) => {
              const styles = typeStyles[notification.type];
              const IconComponent = getIcon(notification.type);

              return (
                <div
                  key={notification.id}
                  className={`
                    p-4 hover:bg-white/5 transition-colors cursor-pointer
                    ${!notification.read ? 'bg-white/[0.02]' : ''}
                  `}
                  onClick={() => markAsRead(notification.id)}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div className={`flex-shrink-0 ${styles.icon}`}>
                      <IconComponent className="w-5 h-5" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h4
                          className={`text-sm font-medium truncate ${
                            notification.read ? 'text-gray-400' : 'text-white'
                          }`}
                        >
                          {notification.title}
                        </h4>
                        <span className="text-xs text-gray-500 flex-shrink-0">
                          {formatTime(notification.timestamp)}
                        </span>
                      </div>
                      {notification.message && (
                        <p className="mt-1 text-sm text-gray-500 line-clamp-2">
                          {notification.message}
                        </p>
                      )}

                      {/* Actions */}
                      {notification.actions && notification.actions.length > 0 && (
                        <div className="mt-2 flex gap-2">
                          {notification.actions.map((action) => (
                            <button
                              key={action.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                triggerAction(notification.id, action.id);
                              }}
                              className={`
                                px-2 py-1 text-xs rounded
                                transition-colors duration-150
                                ${
                                  action.primary
                                    ? `${styles.text} hover:opacity-80`
                                    : 'text-gray-500 hover:text-gray-300'
                                }
                              `}
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Dismiss button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        dismissNotification(notification.id);
                      }}
                      className="flex-shrink-0 p-1 text-gray-600 hover:text-gray-300 rounded transition-colors opacity-0 group-hover:opacity-100"
                      aria-label="Dismiss"
                    >
                      <CloseIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Unread indicator */}
                  {!notification.read && (
                    <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 ${styles.icon} bg-current rounded-r`} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// Notification Bell Button
// ============================================================================

interface NotificationBellProps {
  className?: string;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({ className = '' }) => {
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const toggleHistory = useNotificationStore((state) => state.toggleHistory);
  const isHistoryOpen = useNotificationStore((state) => state.isHistoryOpen);

  return (
    <button
      onClick={toggleHistory}
      className={`
        relative p-2 rounded-lg transition-colors
        ${isHistoryOpen ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}
        ${className}
      `}
      aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
    >
      <BellIcon className="w-5 h-5" />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-xs font-bold text-white bg-red-500 rounded-full">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
};

// ============================================================================
// Main NotificationCenter Component
// ============================================================================

export interface NotificationCenterProps {
  /** Show the bell button */
  showBell?: boolean;
  /** Additional class for bell button */
  bellClassName?: string;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  showBell = true,
  bellClassName = '',
}) => {
  const addNotification = useNotificationStore((state) => state.addNotification);

  // Listen for IPC events from main process
  useEffect(() => {
    if (typeof window !== 'undefined' && window.atlas) {
      // Handle notification created from main process
      const unsubCreated = window.atlas.on('notification:created', (data: unknown) => {
        const notification = data as Notification;
        // Update store with notification from main process
        // Add to local store if needed (currently main process handles persistence)
        if (notification && notification.id) {
          addNotification(notification);
        }
      });

      // Handle notification action from system notification
      const unsubAction = window.atlas.on('notification:action', (data: unknown) => {
        const { notificationId, actionId } = data as {
          notificationId: string;
          actionId: string;
        };
        useNotificationStore.getState().triggerAction(notificationId, actionId);
      });

      // Handle notification clicked from system notification
      const unsubClicked = window.atlas.on('notification:clicked', (data: unknown) => {
        const { id } = data as { id: string };
        useNotificationStore.getState().markAsRead(id);
      });

      return () => {
        unsubCreated();
        unsubAction();
        unsubClicked();
      };
    }
    return undefined;
  }, [addNotification]);

  // Set up keyboard shortcut for notification history
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd + Shift + N to toggle notification history
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'N') {
        event.preventDefault();
        useNotificationStore.getState().toggleHistory();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <>
      {showBell && <NotificationBell className={bellClassName} />}
      <ToastContainer />
      <HistoryPanel />
    </>
  );
};

// Export store hook for external use
export { useNotificationStore };

export default NotificationCenter;
