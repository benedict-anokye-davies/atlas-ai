/**
 * Atlas Desktop - Shortcut Settings Component
 * UI for customizing keyboard shortcuts
 *
 * Session 047-B: Global Hotkeys
 */

import React, { useCallback, useEffect, useState, useRef } from 'react';
import type { ShortcutBinding } from '../../shared/types/shortcuts';
import { getShortcutLabel, getShortcutCategory } from '../../shared/types/shortcuts';

// ============================================================================
// Types
// ============================================================================

interface ShortcutBindingWithStatus extends ShortcutBinding {
  isEnabled: boolean;
  isDefault: boolean;
}

type ShortcutCategory = 'voice' | 'navigation' | 'general';

const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  voice: 'Voice Controls',
  navigation: 'Navigation',
  general: 'General',
};

const CATEGORY_ORDER: ShortcutCategory[] = ['voice', 'navigation', 'general'];

// ============================================================================
// Key Capture Input
// ============================================================================

interface KeyCaptureInputProps {
  accelerator: string;
  onCapture: (accelerator: string) => void;
  onCancel: () => void;
  disabled?: boolean;
}

/**
 * Converts a KeyboardEvent to Electron accelerator format
 */
function keyEventToAccelerator(e: KeyboardEvent): string | null {
  // Ignore modifier-only keypresses
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
    return null;
  }

  const parts: string[] = [];

  // Add modifiers in Electron order
  if (e.ctrlKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  // Map special keys
  const keyMap: Record<string, string> = {
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: 'Escape',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Insert: 'Insert',
  };

  let key = keyMap[e.key] || e.key.toUpperCase();

  // Handle function keys
  if (e.key.match(/^F\d+$/)) {
    key = e.key;
  }

  parts.push(key);
  return parts.join('+');
}

/**
 * Formats an Electron accelerator for display
 */
function formatAccelerator(accelerator: string): string {
  return accelerator.replace(/CommandOrControl/g, 'Ctrl').replace(/\+/g, ' + ');
}

const KeyCaptureInput: React.FC<KeyCaptureInputProps> = ({
  accelerator,
  onCapture,
  onCancel,
  disabled,
}) => {
  const [isCapturing, setIsCapturing] = useState(false);
  const inputRef = useRef<HTMLButtonElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Cancel on Escape
      if (e.key === 'Escape') {
        setIsCapturing(false);
        onCancel();
        return;
      }

      const newAccelerator = keyEventToAccelerator(e);
      if (newAccelerator) {
        setIsCapturing(false);
        onCapture(newAccelerator);
      }
    },
    [onCapture, onCancel]
  );

  useEffect(() => {
    if (isCapturing) {
      window.addEventListener('keydown', handleKeyDown, true);
      return () => window.removeEventListener('keydown', handleKeyDown, true);
    }
    return undefined;
  }, [isCapturing, handleKeyDown]);

  const startCapture = () => {
    if (!disabled) {
      setIsCapturing(true);
    }
  };

  return (
    <button
      ref={inputRef}
      type="button"
      className={`shortcut-key-input ${isCapturing ? 'capturing' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={startCapture}
      disabled={disabled}
      title={isCapturing ? 'Press a key combination' : 'Click to change shortcut'}
    >
      {isCapturing ? (
        <span className="capture-prompt">Press keys...</span>
      ) : (
        <span className="shortcut-display">{formatAccelerator(accelerator)}</span>
      )}
    </button>
  );
};

// ============================================================================
// Shortcut Row
// ============================================================================

interface ShortcutRowProps {
  binding: ShortcutBindingWithStatus;
  onSetBinding: (action: string, accelerator: string) => void;
  onResetBinding: (action: string) => void;
  onToggleEnabled: (action: string, enabled: boolean) => void;
  disabled?: boolean;
}

const ShortcutRow: React.FC<ShortcutRowProps> = ({
  binding,
  onSetBinding,
  onResetBinding,
  onToggleEnabled,
  disabled,
}) => {
  const handleCapture = useCallback(
    (accelerator: string) => {
      onSetBinding(binding.action, accelerator);
    },
    [binding.action, onSetBinding]
  );

  const handleReset = useCallback(() => {
    onResetBinding(binding.action);
  }, [binding.action, onResetBinding]);

  const handleToggle = useCallback(() => {
    onToggleEnabled(binding.action, !binding.isEnabled);
  }, [binding.action, binding.isEnabled, onToggleEnabled]);

  return (
    <div className={`shortcut-row ${!binding.isEnabled ? 'disabled' : ''}`}>
      <div className="shortcut-info">
        <span className="shortcut-name">{getShortcutLabel(binding.action)}</span>
        <span className="shortcut-description">{binding.description}</span>
      </div>
      <div className="shortcut-controls">
        <KeyCaptureInput
          accelerator={binding.accelerator}
          onCapture={handleCapture}
          onCancel={() => {}}
          disabled={disabled || !binding.customizable || !binding.isEnabled}
        />
        {!binding.isDefault && binding.customizable && (
          <button
            type="button"
            className="shortcut-reset-btn"
            onClick={handleReset}
            title="Reset to default"
            disabled={disabled}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className={`shortcut-toggle ${binding.isEnabled ? 'active' : ''}`}
          onClick={handleToggle}
          title={binding.isEnabled ? 'Disable shortcut' : 'Enable shortcut'}
          disabled={disabled}
        >
          <span className="toggle-track">
            <span className="toggle-thumb" />
          </span>
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const ShortcutSettings: React.FC = () => {
  const [bindings, setBindings] = useState<ShortcutBindingWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalEnabled, setGlobalEnabled] = useState(true);

  // Fetch bindings and config on mount
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const [bindingsResult, configResult] = await Promise.all([
          window.atlas?.shortcuts.getBindings(),
          window.atlas?.shortcuts.getConfig(),
        ]);

        if (bindingsResult?.success && bindingsResult.data) {
          const configData = configResult?.data;
          const disabledSet = new Set(configData?.disabled || []);
          const customBindings = configData?.bindings || {};

          // Merge bindings with config
          const mergedBindings: ShortcutBindingWithStatus[] = bindingsResult.data.map((b) => {
            const hasCustomBinding = b.action in customBindings;
            return {
              ...b,
              accelerator: customBindings[b.action] || b.accelerator,
              isEnabled: !disabledSet.has(b.action),
              isDefault: !hasCustomBinding,
            } as ShortcutBindingWithStatus;
          });

          setBindings(mergedBindings);
          setGlobalEnabled(configData?.globalEnabled ?? true);
        } else {
          setError('Failed to load shortcuts');
        }
      } catch (e) {
        setError('Failed to load shortcuts');
        console.error('[ShortcutSettings] Error loading shortcuts:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Handle set custom binding
  const handleSetBinding = useCallback(async (action: string, accelerator: string) => {
    try {
      const result = await window.atlas?.shortcuts.setBinding(action, accelerator);
      if (result?.success) {
        setBindings((prev) =>
          prev.map((b) => (b.action === action ? { ...b, accelerator, isDefault: false } : b))
        );
      } else {
        console.error('[ShortcutSettings] Failed to set binding:', result?.error);
      }
    } catch (e) {
      console.error('[ShortcutSettings] Error setting binding:', e);
    }
  }, []);

  // Handle reset binding
  const handleResetBinding = useCallback(async (action: string) => {
    try {
      const result = await window.atlas?.shortcuts.resetBinding(action);
      if (result?.success) {
        // Refetch to get the default accelerator
        const bindingsResult = await window.atlas?.shortcuts.getBindings();
        if (bindingsResult?.success && bindingsResult.data) {
          const defaultBinding = bindingsResult.data.find((b) => b.action === action);
          if (defaultBinding) {
            setBindings((prev) =>
              prev.map((b) =>
                b.action === action
                  ? { ...b, accelerator: defaultBinding.accelerator, isDefault: true }
                  : b
              )
            );
          }
        }
      }
    } catch (e) {
      console.error('[ShortcutSettings] Error resetting binding:', e);
    }
  }, []);

  // Handle toggle enabled
  const handleToggleEnabled = useCallback(async (action: string, enabled: boolean) => {
    try {
      const result = await window.atlas?.shortcuts.setEnabled(action, enabled);
      if (result?.success) {
        setBindings((prev) =>
          prev.map((b) => (b.action === action ? { ...b, isEnabled: enabled } : b))
        );
      }
    } catch (e) {
      console.error('[ShortcutSettings] Error toggling shortcut:', e);
    }
  }, []);

  // Handle global enable/disable
  const handleToggleGlobal = useCallback(async () => {
    const newValue = !globalEnabled;
    try {
      const result = await window.atlas?.shortcuts.setGlobalEnabled(newValue);
      if (result?.success) {
        setGlobalEnabled(newValue);
      }
    } catch (e) {
      console.error('[ShortcutSettings] Error toggling global shortcuts:', e);
    }
  }, [globalEnabled]);

  // Group bindings by category
  const groupedBindings = bindings.reduce(
    (acc, binding) => {
      const category = getShortcutCategory(binding.action);
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(binding);
      return acc;
    },
    {} as Record<ShortcutCategory, ShortcutBindingWithStatus[]>
  );

  if (loading) {
    return (
      <div className="shortcut-settings-loading">
        <span>Loading shortcuts...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="shortcut-settings-error">
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="shortcut-settings">
      {/* Global Toggle */}
      <div className="shortcut-global-toggle">
        <div className="shortcut-global-info">
          <span className="shortcut-global-label">Global Shortcuts</span>
          <span className="shortcut-global-description">
            Enable shortcuts even when Atlas is not focused
          </span>
        </div>
        <button
          type="button"
          className={`shortcut-toggle global ${globalEnabled ? 'active' : ''}`}
          onClick={handleToggleGlobal}
          title={globalEnabled ? 'Disable global shortcuts' : 'Enable global shortcuts'}
        >
          <span className="toggle-track">
            <span className="toggle-thumb" />
          </span>
        </button>
      </div>

      {/* Shortcut Categories */}
      <div className="shortcut-categories">
        {CATEGORY_ORDER.map((category) => {
          const categoryBindings = groupedBindings[category];
          if (!categoryBindings || categoryBindings.length === 0) return null;

          return (
            <div key={category} className="shortcut-category">
              <h4 className="shortcut-category-title">{CATEGORY_LABELS[category]}</h4>
              <div className="shortcut-category-list">
                {categoryBindings.map((binding) => (
                  <ShortcutRow
                    key={binding.action}
                    binding={binding}
                    onSetBinding={handleSetBinding}
                    onResetBinding={handleResetBinding}
                    onToggleEnabled={handleToggleEnabled}
                    disabled={!globalEnabled && binding.scope === 'global'}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Help Text */}
      <div className="shortcut-help">
        <span>Click on a key combination to change it. Press Escape to cancel.</span>
      </div>
    </div>
  );
};

export default ShortcutSettings;
