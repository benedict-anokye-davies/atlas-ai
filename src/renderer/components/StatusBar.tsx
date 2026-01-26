/**
 * Atlas Desktop - Status Bar Component
 * Shows system information, connection status, active services, and shortcuts
 */

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useAtlasStore } from '../stores';
import { usePerformanceMonitor } from '../hooks';

// ============================================================================
// Types
// ============================================================================

interface StatusBarProps {
  /** Whether the status bar is visible */
  visible?: boolean;
  /** Initial collapsed state */
  initialCollapsed?: boolean;
  /** Position on screen */
  position?: 'top' | 'bottom';
  /** Custom class name */
  className?: string;
}

interface ServiceStatus {
  name: string;
  provider: string | null;
  status: 'active' | 'inactive' | 'error';
  label: string;
}

interface ShortcutHint {
  keys: string[];
  description: string;
}

// ============================================================================
// Constants
// ============================================================================

const KEYBOARD_SHORTCUTS: ShortcutHint[] = [
  { keys: ['Space'], description: 'Activate' },
  { keys: ['Esc'], description: 'Cancel' },
  { keys: ['Ctrl', ','], description: 'Settings' },
  { keys: ['Ctrl', 'D'], description: 'Debug' },
  { keys: ['?'], description: 'Shortcuts' },
];

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Connection status indicator
 */
const ConnectionIndicator = memo(function ConnectionIndicator({
  isOnline,
  isReady,
}: {
  isOnline: boolean;
  isReady: boolean;
}) {
  const status = isReady ? 'connected' : isOnline ? 'connecting' : 'offline';
  const statusText = isReady ? 'Connected' : isOnline ? 'Connecting...' : 'Offline';
  const statusColor =
    status === 'connected'
      ? 'var(--atlas-success)'
      : status === 'connecting'
        ? 'var(--atlas-warning)'
        : 'var(--atlas-error)';

  return (
    <div className="status-bar-item connection-indicator" title={`Connection: ${statusText}`}>
      <span
        className="status-dot"
        style={{
          backgroundColor: statusColor,
          boxShadow: `0 0 6px ${statusColor}`,
        }}
      />
      <span className="status-label">{statusText}</span>
    </div>
  );
});

/**
 * Listening mode indicator
 */
const ListeningModeIndicator = memo(function ListeningModeIndicator({
  state,
  pushToTalk,
  wakeWord,
}: {
  state: string;
  pushToTalk: boolean;
  wakeWord: string;
}) {
  const getModeInfo = () => {
    if (state === 'listening') {
      return { icon: 'mic', text: 'Listening', color: 'var(--orb-listening)' };
    }
    if (state === 'thinking') {
      return { icon: 'brain', text: 'Processing', color: 'var(--orb-thinking)' };
    }
    if (state === 'speaking') {
      return { icon: 'volume', text: 'Speaking', color: 'var(--orb-speaking)' };
    }
    if (pushToTalk) {
      return { icon: 'key', text: 'Push-to-Talk', color: 'var(--atlas-text-secondary)' };
    }
    return { icon: 'wave', text: wakeWord || 'Hey Atlas', color: 'var(--atlas-text-secondary)' };
  };

  const { icon, text, color } = getModeInfo();

  const renderIcon = () => {
    switch (icon) {
      case 'mic':
        return (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        );
      case 'brain':
        return (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        );
      case 'volume':
        return (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        );
      case 'key':
        return (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        );
      default:
        return (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        );
    }
  };

  return (
    <div className="status-bar-item listening-mode" title={`Mode: ${text}`} style={{ color }}>
      {renderIcon()}
      <span className="status-label">{text}</span>
    </div>
  );
});

/**
 * Service status badges
 */
const ServiceBadges = memo(function ServiceBadges({ services }: { services: ServiceStatus[] }) {
  return (
    <div className="status-bar-item service-badges">
      {services.map((service) => (
        <div
          key={service.name}
          className={`service-badge service-${service.status}`}
          title={`${service.label}: ${service.provider || 'Not connected'}`}
        >
          <span className="service-name">{service.name}</span>
          {service.status === 'active' && <span className="service-active-dot" />}
        </div>
      ))}
    </div>
  );
});

/**
 * Memory usage indicator
 */
const MemoryIndicator = memo(function MemoryIndicator({ memoryMB }: { memoryMB: number }) {
  const getMemoryStatus = () => {
    if (memoryMB < 200) return { color: 'var(--atlas-success)', label: 'Low' };
    if (memoryMB < 400) return { color: 'var(--atlas-warning)', label: 'Normal' };
    return { color: 'var(--atlas-error)', label: 'High' };
  };

  const { color, label } = getMemoryStatus();
  const percentage = Math.min((memoryMB / 500) * 100, 100);

  return (
    <div className="status-bar-item memory-indicator" title={`Memory: ${memoryMB}MB (${label})`}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01" />
        <path d="M6 12h12" />
        <path d="M6 16h12" />
      </svg>
      <span className="status-label">{memoryMB}MB</span>
      <div className="memory-bar">
        <div
          className="memory-fill"
          style={{
            width: `${percentage}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
});

/**
 * Microphone level meter
 */
const MicrophoneMeter = memo(function MicrophoneMeter({
  level,
  isListening,
}: {
  level: number;
  isListening: boolean;
}) {
  const normalizedLevel = Math.min(Math.max(level, 0), 1);
  const bars = 5;
  const activeColor = isListening ? 'var(--orb-listening)' : 'var(--atlas-accent)';

  return (
    <div
      className="status-bar-item mic-meter"
      title={`Audio Level: ${Math.round(normalizedLevel * 100)}%`}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      </svg>
      <div className="mic-bars">
        {Array.from({ length: bars }).map((_, i) => {
          const threshold = (i + 1) / bars;
          const isActive = normalizedLevel >= threshold;
          return (
            <div
              key={i}
              className={`mic-bar ${isActive ? 'active' : ''}`}
              style={{
                backgroundColor: isActive ? activeColor : 'var(--atlas-bg-secondary)',
                opacity: isActive ? 1 : 0.3,
              }}
            />
          );
        })}
      </div>
    </div>
  );
});

/**
 * Keyboard shortcut hints
 */
const ShortcutHints = memo(function ShortcutHints({
  shortcuts,
  collapsed,
}: {
  shortcuts: ShortcutHint[];
  collapsed: boolean;
}) {
  if (collapsed) return null;

  return (
    <div className="status-bar-item shortcut-hints">
      {shortcuts.slice(0, 3).map((shortcut, index) => (
        <div key={index} className="shortcut-hint">
          <div className="shortcut-keys">
            {shortcut.keys.map((key, keyIndex) => (
              <span key={keyIndex}>
                <kbd className="key-badge-small">{key}</kbd>
                {keyIndex < shortcut.keys.length - 1 && <span className="key-plus">+</span>}
              </span>
            ))}
          </div>
          <span className="shortcut-desc">{shortcut.description}</span>
        </div>
      ))}
    </div>
  );
});

/**
 * Collapse/expand toggle button
 */
const CollapseToggle = memo(function CollapseToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="status-bar-toggle"
      onClick={onToggle}
      aria-label={collapsed ? 'Expand status bar' : 'Collapse status bar'}
      title={collapsed ? 'Expand status bar' : 'Collapse status bar'}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        style={{
          transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s ease',
        }}
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
});

// ============================================================================
// Main Component
// ============================================================================

/**
 * StatusBar - Displays system information and controls
 */
export function StatusBar({
  visible = true,
  initialCollapsed = false,
  position = 'bottom',
  className = '',
}: StatusBarProps) {
  // State
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Store selectors
  const state = useAtlasStore((s) => s.state);
  const isReady = useAtlasStore((s) => s.isReady);
  const audioLevel = useAtlasStore((s) => s.audioLevel);
  const sttProvider = useAtlasStore((s) => s.sttProvider);
  const llmProvider = useAtlasStore((s) => s.llmProvider);
  const ttsProvider = useAtlasStore((s) => s.ttsProvider);
  const settings = useAtlasStore((s) => s.settings);

  // Performance metrics
  const metrics = usePerformanceMonitor({ enabled: visible && !collapsed });

  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Toggle collapsed state
  const handleToggle = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  // Build service status list
  const services: ServiceStatus[] = useMemo(
    () => [
      {
        name: 'STT',
        provider: sttProvider,
        status: sttProvider ? 'active' : 'inactive',
        label: 'Speech-to-Text',
      },
      {
        name: 'LLM',
        provider: llmProvider,
        status: llmProvider ? 'active' : 'inactive',
        label: 'Language Model',
      },
      {
        name: 'TTS',
        provider: ttsProvider,
        status: ttsProvider ? 'active' : 'inactive',
        label: 'Text-to-Speech',
      },
    ],
    [sttProvider, llmProvider, ttsProvider]
  );

  // Don't render if not visible
  if (!visible) return null;

  return (
    <div
      className={`status-bar status-bar-${position} ${collapsed ? 'collapsed' : 'expanded'} ${className}`}
      role="status"
      aria-label="System status bar"
    >
      {/* Collapsed view - minimal info */}
      {collapsed ? (
        <div className="status-bar-collapsed">
          <ConnectionIndicator isOnline={isOnline} isReady={isReady} />
          <MicrophoneMeter level={audioLevel} isListening={state === 'listening'} />
          <CollapseToggle collapsed={collapsed} onToggle={handleToggle} />
        </div>
      ) : (
        /* Expanded view - full info */
        <div className="status-bar-expanded">
          {/* Left section */}
          <div className="status-bar-section status-bar-left">
            <ConnectionIndicator isOnline={isOnline} isReady={isReady} />
            <div className="status-divider" />
            <ListeningModeIndicator
              state={state}
              pushToTalk={settings.pushToTalk}
              wakeWord={settings.wakeWord}
            />
          </div>

          {/* Center section */}
          <div className="status-bar-section status-bar-center">
            <ServiceBadges services={services} />
          </div>

          {/* Right section */}
          <div className="status-bar-section status-bar-right">
            <MemoryIndicator memoryMB={metrics.memoryUsage || 0} />
            <div className="status-divider" />
            <MicrophoneMeter level={audioLevel} isListening={state === 'listening'} />
            <div className="status-divider" />
            <ShortcutHints shortcuts={KEYBOARD_SHORTCUTS} collapsed={collapsed} />
            <CollapseToggle collapsed={collapsed} onToggle={handleToggle} />
          </div>
        </div>
      )}

      {/* Inline styles for status bar */}
      <style>{`
        .status-bar {
          position: fixed;
          left: 0;
          right: 0;
          display: flex;
          align-items: center;
          padding: 0 12px;
          background: rgba(0, 0, 0, 0.85);
          backdrop-filter: blur(8px);
          border-top: 1px solid rgba(99, 102, 241, 0.15);
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--atlas-text-secondary);
          z-index: 1000;
          transition: all 0.2s ease;
          -webkit-app-region: no-drag;
        }

        .status-bar-top {
          top: 0;
          border-top: none;
          border-bottom: 1px solid rgba(99, 102, 241, 0.15);
        }

        .status-bar-bottom {
          bottom: 0;
        }

        .status-bar.collapsed {
          height: 28px;
        }

        .status-bar.expanded {
          height: 36px;
        }

        .status-bar-collapsed,
        .status-bar-expanded {
          display: flex;
          align-items: center;
          width: 100%;
          gap: 12px;
        }

        .status-bar-expanded {
          justify-content: space-between;
        }

        .status-bar-section {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .status-bar-left {
          flex: 0 0 auto;
        }

        .status-bar-center {
          flex: 1 1 auto;
          justify-content: center;
        }

        .status-bar-right {
          flex: 0 0 auto;
        }

        .status-bar-item {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .status-divider {
          width: 1px;
          height: 16px;
          background: rgba(99, 102, 241, 0.2);
        }

        /* Connection indicator */
        .connection-indicator .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          transition: all 0.3s ease;
        }

        .status-label {
          white-space: nowrap;
        }

        /* Service badges */
        .service-badges {
          gap: 8px;
        }

        .service-badge {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 2px 6px;
          border-radius: 4px;
          background: rgba(99, 102, 241, 0.1);
          border: 1px solid rgba(99, 102, 241, 0.2);
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }

        .service-badge.service-active {
          border-color: rgba(16, 185, 129, 0.4);
          background: rgba(16, 185, 129, 0.1);
        }

        .service-badge.service-inactive {
          opacity: 0.5;
        }

        .service-badge.service-error {
          border-color: rgba(239, 68, 68, 0.4);
          background: rgba(239, 68, 68, 0.1);
        }

        .service-active-dot {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: var(--atlas-success);
          box-shadow: 0 0 4px var(--atlas-success);
        }

        /* Memory indicator */
        .memory-indicator {
          gap: 8px;
        }

        .memory-bar {
          width: 40px;
          height: 4px;
          background: rgba(99, 102, 241, 0.2);
          border-radius: 2px;
          overflow: hidden;
        }

        .memory-fill {
          height: 100%;
          border-radius: 2px;
          transition: width 0.3s ease, background-color 0.3s ease;
        }

        /* Microphone meter */
        .mic-meter {
          gap: 6px;
        }

        .mic-bars {
          display: flex;
          align-items: flex-end;
          gap: 2px;
          height: 12px;
        }

        .mic-bar {
          width: 3px;
          border-radius: 1px;
          transition: all 0.1s ease;
        }

        .mic-bar:nth-child(1) { height: 4px; }
        .mic-bar:nth-child(2) { height: 6px; }
        .mic-bar:nth-child(3) { height: 8px; }
        .mic-bar:nth-child(4) { height: 10px; }
        .mic-bar:nth-child(5) { height: 12px; }

        /* Shortcut hints */
        .shortcut-hints {
          gap: 12px;
        }

        .shortcut-hint {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .shortcut-keys {
          display: flex;
          align-items: center;
        }

        .key-badge-small {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 16px;
          height: 16px;
          padding: 0 4px;
          background: rgba(99, 102, 241, 0.15);
          border: 1px solid rgba(99, 102, 241, 0.3);
          border-radius: 3px;
          font-family: var(--font-mono);
          font-size: 9px;
          color: var(--atlas-text-primary);
        }

        .key-plus {
          margin: 0 2px;
          font-size: 9px;
          opacity: 0.5;
        }

        .shortcut-desc {
          font-size: 10px;
          opacity: 0.7;
        }

        /* Toggle button */
        .status-bar-toggle {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          padding: 0;
          background: transparent;
          border: none;
          border-radius: 4px;
          color: var(--atlas-text-secondary);
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .status-bar-toggle:hover {
          background: rgba(99, 102, 241, 0.2);
          color: var(--atlas-text-primary);
        }

        /* Responsive */
        @media (max-width: 768px) {
          .status-bar.expanded {
            height: 44px;
          }

          .status-bar-expanded {
            flex-wrap: wrap;
            justify-content: center;
          }

          .status-bar-center {
            order: 3;
            flex: 1 0 100%;
            justify-content: center;
          }

          .shortcut-hints {
            display: none;
          }
        }

        @media (max-width: 480px) {
          .status-bar-left .status-label,
          .memory-indicator .status-label {
            display: none;
          }

          .memory-bar {
            width: 30px;
          }
        }
      `}</style>
    </div>
  );
}

export default StatusBar;
