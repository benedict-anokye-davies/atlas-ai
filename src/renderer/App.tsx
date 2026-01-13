/**
 * Nova Desktop - Main App Component
 * Voice-first AI assistant with strange attractor visualization
 */

import { useCallback, useEffect, useState } from 'react';
import { NovaOrb } from './components/orb';
import { useNovaState } from './hooks';
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
    triggerWake,
  } = useNovaState();

  // Local UI state
  const [showTranscript, setShowTranscript] = useState(true);
  const [autoStarted, setAutoStarted] = useState(false);

  // Auto-start the voice pipeline on mount
  useEffect(() => {
    if (!autoStarted && !isReady) {
      setAutoStarted(true);
      start().catch((err) => {
        console.error('[Nova] Failed to auto-start:', err);
      });
    }
  }, [autoStarted, isReady, start]);

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
          particleCount={35000}
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
      </footer>
    </div>
  );
}

export default App;
