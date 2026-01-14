/**
 * Nova Desktop - Error Toast Component
 * User-friendly error notifications with actions
 */

import { useEffect, useState, useCallback } from 'react';
import './ErrorToast.css';

/**
 * Error notification type
 */
export interface ErrorNotification {
  id: string;
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: number;
  recoverable: boolean;
  actions?: ErrorAction[];
}

/**
 * Error action
 */
export interface ErrorAction {
  label: string;
  action: string;
}

/**
 * User-friendly error messages mapping
 */
const ERROR_MESSAGES: Record<string, string> = {
  // API Errors
  DEEPGRAM_ERROR: 'Voice recognition unavailable. Using offline mode.',
  ELEVENLABS_ERROR: 'Voice synthesis unavailable. Using offline mode.',
  LLM_ERROR: 'AI service is slow. Response may be delayed.',
  FIREWORKS_ERROR: 'AI service temporarily unavailable. Trying backup...',
  OPENROUTER_ERROR: 'Backup AI service unavailable.',

  // Network Errors
  NETWORK_ERROR: 'No internet connection. Some features limited.',
  TIMEOUT_ERROR: 'Request timed out. Please try again.',

  // Circuit Breaker
  CIRCUIT_OPEN: 'Service temporarily disabled due to errors. Will retry soon.',

  // Audio Errors
  AUDIO_ERROR: 'Microphone access issue. Check permissions.',
  MIC_NOT_FOUND: 'No microphone detected. Check your audio settings.',

  // TTS Errors
  TTS_ERROR: 'Voice output unavailable. Showing text response.',

  // STT Errors
  STT_ERROR: 'Speech recognition error. Please try speaking again.',

  // Generic
  UNKNOWN_ERROR: 'Something went wrong. Please try again.',
};

/**
 * Get user-friendly message for error code
 */
function getUserFriendlyMessage(code: string, defaultMessage: string): string {
  // Check for exact match
  if (ERROR_MESSAGES[code]) {
    return ERROR_MESSAGES[code];
  }

  // Check for partial match
  const upperCode = code.toUpperCase();
  for (const [key, value] of Object.entries(ERROR_MESSAGES)) {
    if (upperCode.includes(key) || key.includes(upperCode)) {
      return value;
    }
  }

  return defaultMessage;
}

/**
 * Single toast item props
 */
interface ToastItemProps {
  notification: ErrorNotification;
  onDismiss: (id: string) => void;
  onAction: (action: string) => void;
}

/**
 * Single toast item component
 */
function ToastItem({ notification, onDismiss, onAction }: ToastItemProps) {
  const [isExiting, setIsExiting] = useState(false);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onDismiss(notification.id), 300);
  }, [notification.id, onDismiss]);

  // Auto-dismiss after 8 seconds for recoverable errors
  useEffect(() => {
    if (notification.recoverable) {
      const timer = setTimeout(handleDismiss, 8000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [notification.recoverable, handleDismiss]);

  const icon = notification.type === 'error' ? '!' : notification.type === 'warning' ? '!' : 'i';

  const friendlyMessage = getUserFriendlyMessage(notification.title, notification.message);

  return (
    <div
      className={`error-toast error-toast-${notification.type} ${isExiting ? 'error-toast-exit' : ''}`}
      role="alert"
      aria-live={notification.type === 'error' ? 'assertive' : 'polite'}
    >
      <div className="error-toast-icon">
        <span>{icon}</span>
      </div>

      <div className="error-toast-content">
        <div className="error-toast-title">{notification.title}</div>
        <div className="error-toast-message">{friendlyMessage}</div>

        {notification.actions && notification.actions.length > 0 && (
          <div className="error-toast-actions">
            {notification.actions.map((action, index) => (
              <button
                key={index}
                className="error-toast-action"
                onClick={() => onAction(action.action)}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        className="error-toast-dismiss"
        onClick={handleDismiss}
        aria-label="Dismiss notification"
      >
        &times;
      </button>
    </div>
  );
}

/**
 * Error toast container component
 */
export function ErrorToastContainer() {
  const [notifications, setNotifications] = useState<ErrorNotification[]>([]);

  // Listen for error notifications from main process
  useEffect(() => {
    const handleNotification = (...args: unknown[]) => {
      const notification = args[0] as ErrorNotification;
      if (notification && notification.id) {
        setNotifications((prev) => {
          // Prevent duplicates
          if (prev.some((n) => n.id === notification.id)) {
            return prev;
          }
          // Keep only last 5 notifications
          const updated = [...prev, notification];
          return updated.slice(-5);
        });
      }
    };

    const unsubscribe = window.nova?.on('nova:error-notification', handleNotification);
    return () => {
      unsubscribe?.();
    };
  }, []);

  const handleDismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const handleAction = useCallback((action: string) => {
    // Handle actions like retry, settings, etc.
    switch (action) {
      case 'retry':
        window.nova?.invoke('nova:retry-last');
        break;
      case 'settings':
        window.nova?.invoke('nova:open-settings');
        break;
      case 'offline-mode':
        window.nova?.invoke('nova:set-offline-mode', true);
        break;
      default:
        console.log('[ErrorToast] Unknown action:', action);
    }
  }, []);

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="error-toast-container">
      {notifications.map((notification) => (
        <ToastItem
          key={notification.id}
          notification={notification}
          onDismiss={handleDismiss}
          onAction={handleAction}
        />
      ))}
    </div>
  );
}

export default ErrorToastContainer;
