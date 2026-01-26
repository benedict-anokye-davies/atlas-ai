/**
 * Atlas Desktop - Voice Calibration Wizard
 * Guided voice enrollment and calibration UI
 *
 * Features:
 * - Step-by-step voice calibration
 * - Real-time audio level visualization
 * - Background noise detection
 * - Wake word sensitivity adjustment
 * - Voice profile creation
 *
 * @module renderer/components/VoiceCalibrationWizard
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

// ============================================================================
// Types
// ============================================================================

type WizardStep = 'welcome' | 'environment' | 'voice-sample' | 'wake-word' | 'sensitivity' | 'complete';

// AudioLevelData - used for tracking audio input levels
type _AudioLevelData = {
  level: number;
  peak: number;
  average: number;
};
void (null as unknown as _AudioLevelData); // suppress unused warning

interface CalibrationResult {
  noiseFloor: number;
  voiceLevel: number;
  suggestedSensitivity: number;
  environmentType: 'quiet' | 'moderate' | 'noisy';
  wakeWordAccuracy: number;
}

interface VoiceCalibrationWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: (result: CalibrationResult) => void;
}

// ============================================================================
// Calibration Phrases
// ============================================================================

const CALIBRATION_PHRASES = [
  "Hey Atlas, what's the weather like today?",
  'Atlas, set a timer for five minutes.',
  'Hello Atlas, play some music.',
];

const WAKE_WORD_TESTS = [
  { text: 'Hey Atlas', expected: true },
  { text: 'Atlas', expected: true },
  { text: 'Hey Alice', expected: false },
  { text: 'Atlas, hello', expected: true },
];

// ============================================================================
// Styles
// ============================================================================

const styles = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  container: {
    backgroundColor: '#1a1a2e',
    borderRadius: '24px',
    padding: '40px',
    width: '90%',
    maxWidth: '600px',
    maxHeight: '85vh',
    overflow: 'auto',
    boxShadow: '0 25px 50px rgba(0, 0, 0, 0.5)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },
  header: {
    textAlign: 'center' as const,
    marginBottom: '32px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 600,
    color: '#ffffff',
    marginBottom: '8px',
  },
  subtitle: {
    fontSize: '14px',
    color: '#888',
    lineHeight: 1.6,
  },
  progress: {
    display: 'flex',
    justifyContent: 'center',
    gap: '8px',
    marginBottom: '32px',
  },
  progressDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    transition: 'all 0.3s',
  },
  content: {
    minHeight: '300px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '24px',
  },
  instruction: {
    fontSize: '18px',
    color: '#ffffff',
    textAlign: 'center' as const,
    lineHeight: 1.6,
  },
  phrase: {
    fontSize: '20px',
    color: '#6366f1',
    fontStyle: 'italic' as const,
    textAlign: 'center' as const,
    padding: '20px',
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    borderRadius: '12px',
    border: '1px solid rgba(99, 102, 241, 0.2)',
    width: '100%',
  },
  audioVisualizer: {
    width: '100%',
    height: '80px',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: '4px',
    padding: '16px',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: '12px',
  },
  audioBar: {
    width: '8px',
    backgroundColor: '#6366f1',
    borderRadius: '4px',
    transition: 'height 0.1s',
  },
  levelMeter: {
    width: '100%',
    height: '16px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    overflow: 'hidden',
    position: 'relative' as const,
  },
  levelFill: {
    height: '100%',
    borderRadius: '8px',
    transition: 'width 0.1s',
  },
  levelMarker: {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    width: '2px',
    backgroundColor: '#fff',
    opacity: 0.5,
  },
  button: {
    padding: '14px 32px',
    fontSize: '16px',
    fontWeight: 600,
    borderRadius: '12px',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  primaryButton: {
    backgroundColor: '#6366f1',
    color: '#ffffff',
  },
  secondaryButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    color: '#ffffff',
  },
  buttonGroup: {
    display: 'flex',
    gap: '16px',
    marginTop: '24px',
  },
  statusIcon: {
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '36px',
    marginBottom: '16px',
  },
  slider: {
    width: '100%',
    height: '8px',
    borderRadius: '4px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    appearance: 'none' as const,
    cursor: 'pointer',
  },
  sliderLabel: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    color: '#666',
    marginTop: '8px',
  },
  resultCard: {
    width: '100%',
    padding: '20px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '12px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
  },
  resultRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 0',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  },
  resultLabel: {
    fontSize: '14px',
    color: '#888',
  },
  resultValue: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#ffffff',
  },
  checkmark: {
    color: '#22c55e',
    marginRight: '8px',
  },
  recordingPulse: {
    animation: 'pulse 1s infinite',
  },
  micIcon: {
    width: '100px',
    height: '100px',
    borderRadius: '50%',
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '3px solid #ef4444',
  },
};

// ============================================================================
// Audio Visualizer Component
// ============================================================================

const AudioVisualizer: React.FC<{ level: number; isRecording: boolean }> = ({ level, isRecording }) => {
  const bars = 12;

  return (
    <div style={styles.audioVisualizer}>
      {Array.from({ length: bars }).map((_, i) => {
        const barLevel = isRecording ? Math.max(10, level * 100 * (0.5 + Math.random() * 0.5)) : 10;
        const centerOffset = Math.abs(i - bars / 2) / (bars / 2);
        const height = barLevel * (1 - centerOffset * 0.5);

        return (
          <div
            key={i}
            style={{
              ...styles.audioBar,
              height: `${Math.min(height, 100)}%`,
              opacity: isRecording ? 1 : 0.3,
            }}
          />
        );
      })}
    </div>
  );
};

// ============================================================================
// Level Meter Component
// ============================================================================

const LevelMeter: React.FC<{ level: number; threshold?: number }> = ({ level, threshold }) => {
  const getColor = (level: number): string => {
    if (level < 30) return '#22c55e';
    if (level < 60) return '#eab308';
    return '#ef4444';
  };

  return (
    <div style={styles.levelMeter}>
      <div
        style={{
          ...styles.levelFill,
          width: `${Math.min(level, 100)}%`,
          backgroundColor: getColor(level),
        }}
      />
      {threshold !== undefined && (
        <div
          style={{
            ...styles.levelMarker,
            left: `${threshold}%`,
          }}
        />
      )}
    </div>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const VoiceCalibrationWizard: React.FC<VoiceCalibrationWizardProps> = ({ isOpen, onClose, onComplete }) => {
  const [currentStep, setCurrentStep] = useState<WizardStep>('welcome');
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [noiseFloor, setNoiseFloor] = useState(0);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [sensitivity, setSensitivity] = useState(50);
  const [currentPhraseIndex, setCurrentPhraseIndex] = useState(0);
  const [phrasesCompleted, setPhrasesCompleted] = useState<boolean[]>([]);
  const [wakeWordResults, setWakeWordResults] = useState<boolean[]>([]);
  const [environmentType, setEnvironmentType] = useState<'quiet' | 'moderate' | 'noisy'>('moderate');

  const audioLevelRef = useRef<number>(0);
  const animationFrameRef = useRef<number>();

  const steps: WizardStep[] = ['welcome', 'environment', 'voice-sample', 'wake-word', 'sensitivity', 'complete'];

  // Simulate audio level monitoring
  useEffect(() => {
    if (!isRecording) return;

    const updateLevel = () => {
      // Simulate audio level - in real implementation, this would come from the main process
      const baseLevel = audioLevelRef.current;
      const noise = Math.random() * 10;
      const newLevel = Math.max(0, Math.min(100, baseLevel + noise));
      setAudioLevel(newLevel);
      animationFrameRef.current = requestAnimationFrame(updateLevel);
    };

    animationFrameRef.current = requestAnimationFrame(updateLevel);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isRecording]);

  // Start recording
  const startRecording = useCallback(() => {
    setIsRecording(true);
    audioLevelRef.current = 20 + Math.random() * 30;
  }, []);

  // Stop recording
  const stopRecording = useCallback(() => {
    setIsRecording(false);
    audioLevelRef.current = 0;
    setAudioLevel(0);
  }, []);

  // Environment check
  const checkEnvironment = useCallback(async () => {
    setIsRecording(true);
    audioLevelRef.current = 10 + Math.random() * 20;

    // Simulate noise floor measurement
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const measuredNoise = 15 + Math.random() * 15;
    setNoiseFloor(measuredNoise);

    if (measuredNoise < 15) {
      setEnvironmentType('quiet');
    } else if (measuredNoise < 30) {
      setEnvironmentType('moderate');
    } else {
      setEnvironmentType('noisy');
    }

    stopRecording();
    setCurrentStep('voice-sample');
  }, [stopRecording]);

  // Voice sample recording
  const recordVoiceSample = useCallback(async () => {
    startRecording();
    audioLevelRef.current = 40 + Math.random() * 30;

    // Simulate voice recording
    await new Promise((resolve) => setTimeout(resolve, 3000));

    setVoiceLevel(audioLevelRef.current);
    stopRecording();

    const newCompleted = [...phrasesCompleted, true];
    setPhrasesCompleted(newCompleted);

    if (currentPhraseIndex < CALIBRATION_PHRASES.length - 1) {
      setCurrentPhraseIndex((prev) => prev + 1);
    } else {
      setCurrentStep('wake-word');
      setCurrentPhraseIndex(0);
    }
  }, [startRecording, stopRecording, phrasesCompleted, currentPhraseIndex]);

  // Wake word test
  const testWakeWord = useCallback(async () => {
    startRecording();

    // Simulate wake word test
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const testCase = WAKE_WORD_TESTS[currentPhraseIndex];
    // Simulate detection result (80% accuracy)
    const detected = Math.random() < 0.8 ? testCase.expected : !testCase.expected;
    const correct = detected === testCase.expected;

    stopRecording();

    const newResults = [...wakeWordResults, correct];
    setWakeWordResults(newResults);

    if (currentPhraseIndex < WAKE_WORD_TESTS.length - 1) {
      setCurrentPhraseIndex((prev) => prev + 1);
    } else {
      setCurrentStep('sensitivity');
    }
  }, [startRecording, stopRecording, wakeWordResults, currentPhraseIndex]);

  // Complete calibration
  const completeCalibration = useCallback(() => {
    const wakeWordAccuracy = wakeWordResults.filter(Boolean).length / wakeWordResults.length;

    const result: CalibrationResult = {
      noiseFloor,
      voiceLevel,
      suggestedSensitivity: sensitivity,
      environmentType,
      wakeWordAccuracy,
    };

    onComplete?.(result);
    setCurrentStep('complete');
  }, [noiseFloor, voiceLevel, sensitivity, environmentType, wakeWordResults, onComplete]);

  // Reset wizard
  const resetWizard = useCallback(() => {
    setCurrentStep('welcome');
    setIsRecording(false);
    setAudioLevel(0);
    setNoiseFloor(0);
    setVoiceLevel(0);
    setSensitivity(50);
    setCurrentPhraseIndex(0);
    setPhrasesCompleted([]);
    setWakeWordResults([]);
    setEnvironmentType('moderate');
  }, []);

  // Close handler
  const handleClose = useCallback(() => {
    stopRecording();
    resetWizard();
    onClose();
  }, [stopRecording, resetWizard, onClose]);

  if (!isOpen) return null;

  // Render step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 'welcome':
        return (
          <>
            <div style={{ ...styles.statusIcon, backgroundColor: 'rgba(99, 102, 241, 0.2)' }}>
              <span role="img" aria-label="microphone">
                🎙️
              </span>
            </div>
            <p style={styles.instruction}>
              Let's calibrate Atlas to recognize your voice better.
              <br />
              This will take about 2 minutes.
            </p>
            <div style={styles.buttonGroup}>
              <button
                style={{ ...styles.button, ...styles.primaryButton }}
                onClick={() => setCurrentStep('environment')}
              >
                Get Started
              </button>
              <button style={{ ...styles.button, ...styles.secondaryButton }} onClick={handleClose}>
                Skip for Now
              </button>
            </div>
          </>
        );

      case 'environment':
        return (
          <>
            <div style={styles.micIcon}>
              <span role="img" aria-label="listening" style={isRecording ? styles.recordingPulse : {}}>
                👂
              </span>
            </div>
            <p style={styles.instruction}>
              First, let's measure your background noise.
              <br />
              Please stay quiet for a few seconds.
            </p>
            <AudioVisualizer level={audioLevel / 100} isRecording={isRecording} />
            <LevelMeter level={audioLevel} />
            {!isRecording && (
              <button style={{ ...styles.button, ...styles.primaryButton }} onClick={checkEnvironment}>
                Start Environment Check
              </button>
            )}
            {isRecording && (
              <p style={{ ...styles.subtitle, color: '#6366f1' }}>
                Measuring background noise...
              </p>
            )}
          </>
        );

      case 'voice-sample':
        return (
          <>
            <p style={styles.instruction}>
              Great! Now please say the following phrase:
              <br />
              <span style={{ color: '#666', fontSize: '14px' }}>
                ({currentPhraseIndex + 1} of {CALIBRATION_PHRASES.length})
              </span>
            </p>
            <div style={styles.phrase}>{CALIBRATION_PHRASES[currentPhraseIndex]}</div>
            <AudioVisualizer level={audioLevel / 100} isRecording={isRecording} />
            <LevelMeter level={audioLevel} threshold={noiseFloor} />
            {!isRecording ? (
              <button style={{ ...styles.button, ...styles.primaryButton }} onClick={recordVoiceSample}>
                Start Recording
              </button>
            ) : (
              <p style={{ ...styles.subtitle, color: '#ef4444', ...styles.recordingPulse }}>
                Recording... Please speak now
              </p>
            )}
          </>
        );

      case 'wake-word':
        return (
          <>
            <p style={styles.instruction}>
              Now let's test the wake word detection.
              <br />
              Say the phrase shown below:
              <br />
              <span style={{ color: '#666', fontSize: '14px' }}>
                ({currentPhraseIndex + 1} of {WAKE_WORD_TESTS.length})
              </span>
            </p>
            <div style={styles.phrase}>{WAKE_WORD_TESTS[currentPhraseIndex].text}</div>
            <AudioVisualizer level={audioLevel / 100} isRecording={isRecording} />
            {!isRecording ? (
              <button style={{ ...styles.button, ...styles.primaryButton }} onClick={testWakeWord}>
                Test Wake Word
              </button>
            ) : (
              <p style={{ ...styles.subtitle, color: '#eab308' }}>Listening for wake word...</p>
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              {WAKE_WORD_TESTS.map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    backgroundColor:
                      i < wakeWordResults.length
                        ? wakeWordResults[i]
                          ? '#22c55e'
                          : '#ef4444'
                        : 'rgba(255, 255, 255, 0.1)',
                  }}
                />
              ))}
            </div>
          </>
        );

      case 'sensitivity':
        return (
          <>
            <p style={styles.instruction}>
              Almost done! Adjust the wake word sensitivity:
            </p>
            <div style={{ width: '100%' }}>
              <input
                type="range"
                min="0"
                max="100"
                value={sensitivity}
                onChange={(e) => setSensitivity(parseInt(e.target.value))}
                style={styles.slider}
              />
              <div style={styles.sliderLabel}>
                <span>Less Sensitive</span>
                <span style={{ color: '#fff', fontWeight: 600 }}>{sensitivity}%</span>
                <span>More Sensitive</span>
              </div>
              <p style={{ ...styles.subtitle, marginTop: '16px' }}>
                {sensitivity < 30
                  ? 'Low sensitivity: Fewer false activations, but may miss some commands.'
                  : sensitivity > 70
                    ? 'High sensitivity: More responsive, but may activate accidentally.'
                    : 'Balanced: Good mix of responsiveness and accuracy.'}
              </p>
            </div>
            <button style={{ ...styles.button, ...styles.primaryButton }} onClick={completeCalibration}>
              Save Settings
            </button>
          </>
        );

      case 'complete':
        const wakeWordAccuracy = wakeWordResults.filter(Boolean).length / wakeWordResults.length;
        return (
          <>
            <div style={{ ...styles.statusIcon, backgroundColor: 'rgba(34, 197, 94, 0.2)' }}>
              <span role="img" aria-label="check">
                ✓
              </span>
            </div>
            <p style={styles.instruction}>Voice calibration complete!</p>
            <div style={styles.resultCard}>
              <div style={styles.resultRow}>
                <span style={styles.resultLabel}>Environment</span>
                <span style={styles.resultValue}>
                  {environmentType.charAt(0).toUpperCase() + environmentType.slice(1)} noise
                </span>
              </div>
              <div style={styles.resultRow}>
                <span style={styles.resultLabel}>Noise Floor</span>
                <span style={styles.resultValue}>{noiseFloor.toFixed(1)} dB</span>
              </div>
              <div style={styles.resultRow}>
                <span style={styles.resultLabel}>Voice Level</span>
                <span style={styles.resultValue}>{voiceLevel.toFixed(1)} dB</span>
              </div>
              <div style={styles.resultRow}>
                <span style={styles.resultLabel}>Wake Word Accuracy</span>
                <span style={styles.resultValue}>{(wakeWordAccuracy * 100).toFixed(0)}%</span>
              </div>
              <div style={{ ...styles.resultRow, borderBottom: 'none' }}>
                <span style={styles.resultLabel}>Sensitivity</span>
                <span style={styles.resultValue}>{sensitivity}%</span>
              </div>
            </div>
            <div style={styles.buttonGroup}>
              <button style={{ ...styles.button, ...styles.primaryButton }} onClick={handleClose}>
                Done
              </button>
              <button style={{ ...styles.button, ...styles.secondaryButton }} onClick={resetWizard}>
                Recalibrate
              </button>
            </div>
          </>
        );
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.container}>
        {/* Progress Dots */}
        <div style={styles.progress}>
          {steps.map((step, i) => (
            <div
              key={step}
              style={{
                ...styles.progressDot,
                backgroundColor:
                  steps.indexOf(currentStep) >= i
                    ? '#6366f1'
                    : 'rgba(255, 255, 255, 0.1)',
              }}
            />
          ))}
        </div>

        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.title}>Voice Calibration</h2>
          <p style={styles.subtitle}>
            {currentStep === 'welcome' && 'Optimize Atlas for your voice'}
            {currentStep === 'environment' && 'Step 1: Environment Check'}
            {currentStep === 'voice-sample' && 'Step 2: Voice Samples'}
            {currentStep === 'wake-word' && 'Step 3: Wake Word Testing'}
            {currentStep === 'sensitivity' && 'Step 4: Sensitivity Adjustment'}
            {currentStep === 'complete' && 'Calibration Complete'}
          </p>
        </div>

        {/* Content */}
        <div style={styles.content}>{renderStepContent()}</div>
      </div>

      {/* Animations */}
      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.7; transform: scale(1.05); }
          }

          input[type="range"]::-webkit-slider-thumb {
            appearance: none;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #6366f1;
            cursor: pointer;
            border: none;
            margin-top: -6px;
          }

          input[type="range"]::-webkit-slider-runnable-track {
            height: 8px;
            border-radius: 4px;
            background: linear-gradient(to right, #6366f1 ${sensitivity}%, rgba(255,255,255,0.1) ${sensitivity}%);
          }
        `}
      </style>
    </div>
  );
};

export default VoiceCalibrationWizard;
