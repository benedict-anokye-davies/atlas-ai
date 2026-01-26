/**
 * Atlas Desktop - Onboarding Step: Microphone Permission
 * Requests and tests microphone access with visual feedback
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useOnboardingStore } from '../../stores/onboardingStore';

interface StepMicrophoneProps {
  onComplete: () => void;
}

/**
 * Audio level visualization component
 */
const AudioLevelIndicator: React.FC<{ level: number; isActive: boolean }> = ({ level, isActive }) => {
  const bars = 12;
  const activeBars = Math.round((level / 100) * bars);

  return (
    <div className="audio-level-indicator">
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className={`audio-bar ${i < activeBars && isActive ? 'active' : ''} ${
            i >= bars * 0.7 ? 'high' : i >= bars * 0.4 ? 'medium' : 'low'
          }`}
        />
      ))}
    </div>
  );
};

export const StepMicrophone: React.FC<StepMicrophoneProps> = ({ onComplete }) => {
  const {
    hasMicrophonePermission,
    isMicrophoneTesting,
    microphoneLevel,
    microphoneError,
    setMicrophonePermission,
    setMicrophoneTesting,
    setMicrophoneLevel,
    setMicrophoneError,
    completeStep,
  } = useOnboardingStore();

  const [isRequesting, setIsRequesting] = useState(false);
  const [testDuration, setTestDuration] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const testTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Request microphone permission
  const requestPermission = useCallback(async () => {
    setIsRequesting(true);
    setMicrophoneError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;
      setMicrophonePermission(true);

      // Setup audio analysis
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to access microphone';

      if (errorMessage.includes('Permission denied') || errorMessage.includes('NotAllowedError')) {
        setMicrophoneError(
          'Microphone access was denied. Please allow microphone access in your browser settings.'
        );
      } else if (errorMessage.includes('NotFoundError')) {
        setMicrophoneError('No microphone found. Please connect a microphone and try again.');
      } else {
        setMicrophoneError(errorMessage);
      }

      setMicrophonePermission(false);
    } finally {
      setIsRequesting(false);
    }
  }, [setMicrophonePermission, setMicrophoneError]);

  // Start audio level monitoring
  const startTesting = useCallback(() => {
    if (!analyserRef.current) return;

    setMicrophoneTesting(true);
    setTestDuration(0);

    // Start test timer
    testTimerRef.current = setInterval(() => {
      setTestDuration((prev) => prev + 1);
    }, 1000);

    const analyser = analyserRef.current;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const updateLevel = () => {
      analyser.getByteFrequencyData(dataArray);

      // Calculate average level
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      const normalizedLevel = Math.min(100, (average / 128) * 100);

      setMicrophoneLevel(normalizedLevel);
      animationRef.current = requestAnimationFrame(updateLevel);
    };

    updateLevel();
  }, [setMicrophoneTesting, setMicrophoneLevel]);

  // Stop testing
  const stopTesting = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    if (testTimerRef.current) {
      clearInterval(testTimerRef.current);
      testTimerRef.current = null;
    }

    setMicrophoneTesting(false);
    setMicrophoneLevel(0);
  }, [setMicrophoneTesting, setMicrophoneLevel]);

  // Handle continue
  const handleContinue = useCallback(() => {
    stopTesting();
    completeStep('microphone');
    onComplete();
  }, [stopTesting, completeStep, onComplete]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      if (testTimerRef.current) {
        clearInterval(testTimerRef.current);
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, []);

  return (
    <div className="onboarding-step step-microphone">
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
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>
      </div>

      <h2 className="step-title">Microphone Access</h2>
      <p className="step-description">
        Atlas needs microphone access to hear your voice commands. We will test your microphone to
        make sure everything works correctly.
      </p>

      {/* Permission Request */}
      {!hasMicrophonePermission && (
        <div className="permission-section">
          {microphoneError && (
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
              <span>{microphoneError}</span>
            </div>
          )}

          <button
            className="onboarding-button primary"
            onClick={requestPermission}
            disabled={isRequesting}
          >
            {isRequesting ? (
              <>
                <span className="spinner" />
                Requesting access...
              </>
            ) : (
              <>
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
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                </svg>
                Allow Microphone Access
              </>
            )}
          </button>
        </div>
      )}

      {/* Microphone Testing */}
      {hasMicrophonePermission && (
        <div className="testing-section">
          <div className="success-badge">
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
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span>Microphone access granted</span>
          </div>

          <div className="audio-test-container">
            <AudioLevelIndicator level={microphoneLevel} isActive={isMicrophoneTesting} />

            {isMicrophoneTesting ? (
              <div className="test-info">
                <p className="test-instruction">Speak or make some noise to test your microphone</p>
                <p className="test-timer">Testing for {testDuration}s</p>
              </div>
            ) : (
              <p className="test-instruction">Click the button below to test your microphone</p>
            )}
          </div>

          <div className="button-group">
            {!isMicrophoneTesting ? (
              <button className="onboarding-button secondary" onClick={startTesting}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  stroke="none"
                >
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Test Microphone
              </button>
            ) : (
              <button className="onboarding-button secondary" onClick={stopTesting}>
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
                Stop Test
              </button>
            )}

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
          </div>
        </div>
      )}
    </div>
  );
};

export default StepMicrophone;
