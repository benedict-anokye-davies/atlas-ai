/**
 * Nova Desktop - Main App Component
 * Voice-first AI assistant with strange attractor visualization
 */

import { useCallback, useEffect, useState } from 'react';
import { NovaOrb } from './components/orb';
import { Settings } from './components/Settings';
import { DebugOverlay } from './components/DebugOverlay';
import { ErrorToastContainer } from './components/ErrorToast';
import { useNovaState, useAdaptiveParticles } from './hooks';
import { useNovaStore } from './stores';
import './styles/App.css';

function App() {
  const {
    state,
    isReady,
    audioLevel,
    transcript,
    interimTranscript,
    response,
    isThinking,
    error,
    start,
    stop,
    triggerWake,
  } = useNovaState();

  const { settings, toggleSettings, updateSettings } = useNovaStore();

  // Local UI state
  const [showTranscript, setShowTranscript] = useState(true);
  const [autoStarted, setAutoStarted] = useState(false);

  // Adaptive particle count based on performance
  const { particleCount: adaptiveParticleCount } = useAdaptiveParticles({
    initialParticles: settings.particleCount || 30000,
    enabled: settings.adaptivePerformance ?? true,
    targetFps: 55,
    minParticles: 2000,
    maxParticles: 50000,
  });

  // Use adaptive count if enabled, otherwise use settings
  const effectiveParticleCount =
    (settings.adaptivePerformance ?? true) ? adaptiveParticleCount : settings.particleCount || 30000;

  // Sync showTranscript with settings
  useEffect(() => {
    setShowTranscript(settings.showTranscript);
  }, [settings.showTranscript]);

  // Auto-start the voice pipeline on mount (if enabled)
  useEffect(() => {
    if (!autoStarted && !isReady && settings.autoStart) {
      setAutoStarted(true);
      start().catch((err) => {
        console.error('[Nova] Failed to auto-start:', err);
      });
    }
  }, [autoStarted, isReady, start, settings.autoStart]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input field or settings is open
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      switch (e.key) {
        case ' ': // Space - trigger wake / start listening
          e.preventDefault();
          if (state === 'idle' && isReady) {
            triggerWake();
          }
          break;

        case 'Escape': // Escape - stop / cancel
          e.preventDefault();
          if (state === 'listening' || state === 'thinking') {
            stop();
          }
          break;

        case ',': // Comma - open settings (like macOS conventions)
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            toggleSettings();
          }
          break;

        case 'd': // D - toggle debug overlay
        case 'D':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            updateSettings({ showDebug: !settings.showDebug });
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state, isReady, triggerWake, stop, toggleSettings, updateSettings, settings.showDebug]);

  // Listen for IPC events to open settings
  useEffect(() => {
    const handleOpenSettings = () => toggleSettings();
    const unsubscribe = window.nova?.on('nova:open-settings', handleOpenSettings);
    return () => {
      unsubscribe?.();
    };
  }, [toggleSettings]);

  // Handle orb click - trigger wake or toggle transcript
  const handleOrbClick = useCallback(() => {
    if (state === 'idle') {
      triggerWake();
    } else {
      setShowTranscript((prev) => !prev);
    }
  }, [state, triggerWake]);

  // Get status text based on state
  const getStatusText = () => {
    switch (state) {
      case 'listening':
        return 'Listening...';
      case 'thinking':
        return 'Thinking...';
      case 'speaking':
        return 'Speaking...';
      case 'error':
        return `Error: ${error || 'Unknown'}`;
      default:
        return isReady ? 'Say "Hey Nova" or click the orb' : 'Starting...';
    }
  };

  // Get the display text (interim or final transcript)
  const displayTranscript = interimTranscript || transcript;

  return (
    <div className="nova-app">
      {/* Background gradient */}
      <div className="nova-background" />

      {/* Main orb visualization */}
      <main className="nova-main">
        <NovaOrb
          state={state}
          audioLevel={audioLevel}
          particleCount={effectiveParticleCount}
          onStateClick={handleOrbClick}
          className="nova-orb-main"
        />

        {/* Status indicator */}
        <div className={`nova-status nova-status-${state}`}>
          <span className="status-dot" />
          <span className="status-text">{getStatusText()}</span>
        </div>

        {/* Transcript display */}
        {showTranscript && (displayTranscript || response) && (
          <div className="nova-conversation">
            {/* User transcript */}
            {displayTranscript && (
              <div className="conversation-user">
                <span className="conversation-label">You</span>
                <p className="conversation-text">
                  {displayTranscript}
                  {interimTranscript && <span className="typing-indicator">...</span>}
                </p>
              </div>
            )}

            {/* Nova response */}
            {(response || isThinking) && (
              <div className="conversation-nova">
                <span className="conversation-label">Nova</span>
                <p className="conversation-text">
                  {response || ''}
                  {isThinking && !response && (
                    <span className="thinking-dots">
                      <span>.</span>
                      <span>.</span>
                      <span>.</span>
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer with controls */}
      <footer className="nova-footer">
        <div className="footer-info">
          <span className={`connection-status ${isReady ? 'connected' : 'disconnected'}`}>
            {isReady ? '● Connected' : '○ Disconnected'}
          </span>
        </div>
        <div className="footer-actions">
          <button
            className="footer-button"
            onClick={toggleSettings}
            aria-label="Settings"
            title="Settings (Ctrl+,)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </footer>

      {/* Settings Panel */}
      <Settings />

      {/* Error Toast Notifications */}
      <ErrorToastContainer />

      {/* Debug Overlay (dev mode only) */}
      <DebugOverlay visible={settings.showDebug ?? false} particleCount={effectiveParticleCount} />
    </div>
  );
}

export default App;
