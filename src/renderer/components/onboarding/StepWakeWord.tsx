/**
 * Atlas Desktop - Onboarding Step: Wake Word Test
 * Tests wake word detection by having user say "Hey Atlas"
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useOnboardingStore } from '../../stores/onboardingStore';

interface StepWakeWordProps {
  onComplete: () => void;
}

/**
 * Animated pulse ring for listening state
 */
const PulseRing: React.FC<{ isActive: boolean }> = ({ isActive }) => (
  <div className={`pulse-ring-container ${isActive ? 'active' : ''}`}>
    <div className="pulse-ring ring-1" />
    <div className="pulse-ring ring-2" />
    <div className="pulse-ring ring-3" />
  </div>
);

/**
 * Wake word visualization orb
 */
const WakeWordOrb: React.FC<{ isListening: boolean; isDetected: boolean }> = ({
  isListening,
  isDetected,
}) => (
  <div
    className={`wake-word-orb ${isListening ? 'listening' : ''} ${isDetected ? 'detected' : ''}`}
  >
    <PulseRing isActive={isListening} />
    <div className="orb-core">
      {isDetected ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>
      )}
    </div>
  </div>
);

export const StepWakeWord: React.FC<StepWakeWordProps> = ({ onComplete }) => {
  const {
    isWakeWordTesting,
    wakeWordDetected,
    wakeWordError,
    setWakeWordTesting,
    setWakeWordDetected,
    setWakeWordError,
    completeStep,
  } = useOnboardingStore();

  const [listenTimeout, setListenTimeout] = useState(30);
  const [attemptCount, setAttemptCount] = useState(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  // Start listening for wake word
  const startListening = useCallback(async (): Promise<void> => {
    setWakeWordError(null);
    setWakeWordTesting(true);
    setListenTimeout(30);
    setAttemptCount((prev) => prev + 1);

    // Start countdown timer
    countdownRef.current = setInterval(() => {
      setListenTimeout((prev) => {
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Start wake word detection via IPC
    try {
      // Listen for wake word detection event
      window.atlas?.on('atlas:wake-word-detected', () => {
        setWakeWordDetected(true);
        stopListening();
      });

      // Start the wake word detection in test mode
      await window.atlas?.voice.startWakeWord();

      // Set timeout for listening
      timeoutRef.current = setTimeout(() => {
        if (!wakeWordDetected) {
          setWakeWordError('Wake word not detected. Please try again and speak clearly.');
          stopListening();
        }
      }, 30000);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start wake word detection';
      setWakeWordError(errorMessage);
      stopListening();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setWakeWordTesting, setWakeWordError, setWakeWordDetected, wakeWordDetected]);

  // Stop listening
  const stopListening = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }

    setWakeWordTesting(false);

    // Stop voice pipeline
    window.atlas?.voice.stopWakeWord().catch(console.error);
  }, [setWakeWordTesting]);

  // Handle continue
  const handleContinue = useCallback(() => {
    stopListening();
    completeStep('wakeWord');
    onComplete();
  }, [stopListening, completeStep, onComplete]);

  // Handle skip (if multiple failed attempts)
  const handleSkip = useCallback(() => {
    stopListening();
    completeStep('wakeWord');
    onComplete();
  }, [stopListening, completeStep, onComplete]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
      }
      window.atlas?.voice.stopWakeWord().catch(() => {});
    };
  }, []);

  // Auto-timeout when countdown reaches 0
  useEffect(() => {
    if (listenTimeout === 0 && isWakeWordTesting && !wakeWordDetected) {
      setWakeWordError('Wake word not detected. Please try again and speak clearly.');
      stopListening();
    }
  }, [listenTimeout, isWakeWordTesting, wakeWordDetected, stopListening, setWakeWordError]);

  return (
    <div className="onboarding-step step-wake-word">
      <div className="step-icon">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 6V2H8" />
          <path d="m8 18-4 4V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2Z" />
          <path d="M12 12v-2" />
          <path d="M12 16h.01" />
        </svg>
      </div>

      <h2 className="step-title">Wake Word Test</h2>
      <p className="step-description">
        Atlas activates when you say <strong>&quot;Hey Atlas&quot;</strong>. Let us test this to make sure
        it is working properly.
      </p>

      {/* Wake Word Orb */}
      <div className="wake-word-container">
        <WakeWordOrb isListening={isWakeWordTesting} isDetected={wakeWordDetected} />

        {isWakeWordTesting && !wakeWordDetected && (
          <div className="listening-status">
            <p className="listening-text">Listening... Say &quot;Hey Atlas&quot;</p>
            <p className="listening-timer">{listenTimeout}s remaining</p>
          </div>
        )}

        {wakeWordDetected && (
          <div className="detected-status">
            <p className="detected-text">Wake word detected!</p>
            <p className="detected-subtext">Atlas heard you loud and clear</p>
          </div>
        )}
      </div>

      {/* Error Message */}
      {wakeWordError && (
        <div className="error-message">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" x2="12" y1="8" y2="12" />
            <line x1="12" x2="12.01" y1="16" y2="16" />
          </svg>
          <span>{wakeWordError}</span>
        </div>
      )}

      {/* Tips Section */}
      {attemptCount > 0 && !wakeWordDetected && !isWakeWordTesting && (
        <div className="tips-section">
          <h4>Tips for better detection:</h4>
          <ul>
            <li>Speak clearly and at normal volume</li>
            <li>Reduce background noise if possible</li>
            <li>Position your microphone closer</li>
            <li>Say &quot;Hey Atlas&quot; with a slight pause after &quot;Hey&quot;</li>
          </ul>
        </div>
      )}

      {/* Button Group */}
      <div className="button-group">
        {!wakeWordDetected && (
          <>
            {!isWakeWordTesting ? (
              <button className="onboarding-button primary" onClick={startListening}>
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
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                </svg>
                {attemptCount > 0 ? 'Try Again' : 'Start Listening'}
              </button>
            ) : (
              <button className="onboarding-button secondary" onClick={stopListening}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  stroke="none"
                >
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
                Stop
              </button>
            )}

            {attemptCount >= 2 && (
              <button className="onboarding-button text" onClick={handleSkip}>
                Skip this step
              </button>
            )}
          </>
        )}

        {wakeWordDetected && (
          <button className="onboarding-button primary" onClick={handleContinue}>
            Continue
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
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};

export default StepWakeWord;
