/**
 * Atlas Desktop - Wake Word Setup Component
 * Allows users to train custom wake words by recording audio samples
 *
 * Features:
 * - Record 3 audio samples of custom phrase
 * - Real-time audio level visualization
 * - Recording quality feedback
 * - Built-in wake word selection as alternative
 * - Import pre-trained models
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================================
// Types
// ============================================================================

interface RecordingQuality {
  score: number;
  acceptable: boolean;
  averageLevel: number;
  peakLevel: number;
  snrEstimate: number;
  duration: number;
  issues: string[];
  suggestions: string[];
}

interface TrainingSample {
  index: number;
  duration: number;
  quality: RecordingQuality;
  filePath?: string;
}

interface TrainingSession {
  id: string;
  phrase: string;
  samples: TrainingSample[];
  requiredSamples: number;
  currentSampleIndex: number;
  status: 'in_progress' | 'ready_for_training' | 'training' | 'complete' | 'failed';
  error?: string;
  modelPath?: string;
}

interface TrainingProgressEvent {
  state: string;
  sampleIndex: number;
  totalSamples: number;
  countdown?: number;
  recordingProgress?: number;
  audioLevel?: number;
  message: string;
}

interface CustomWakeWordModel {
  id: string;
  displayName: string;
  modelPath: string;
  createdAt: number;
  isActive: boolean;
  sensitivity: number;
}

type RecordingState =
  | 'idle'
  | 'preparing'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'validating'
  | 'complete'
  | 'error';

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Audio level visualizer component
 */
const AudioLevelMeter: React.FC<{ level: number; isRecording: boolean }> = ({
  level,
  isRecording,
}) => {
  const segments = 20;
  const activeSegments = Math.round(level * segments);

  return (
    <div className="audio-level-meter">
      <div className="level-bars">
        {Array.from({ length: segments }).map((_, i) => (
          <div
            key={i}
            className={`level-bar ${i < activeSegments ? 'active' : ''} ${
              i >= segments * 0.8 ? 'high' : i >= segments * 0.6 ? 'medium' : ''
            }`}
            style={{
              opacity: isRecording ? 1 : 0.3,
              transform: i < activeSegments ? 'scaleY(1)' : 'scaleY(0.3)',
            }}
          />
        ))}
      </div>
      <span className="level-label">{Math.round(level * 100)}%</span>
    </div>
  );
};

/**
 * Recording progress indicator
 */
const RecordingProgress: React.FC<{
  currentSample: number;
  totalSamples: number;
  samples: TrainingSample[];
}> = ({ currentSample, totalSamples, samples }) => {
  return (
    <div className="recording-progress">
      <div className="progress-dots">
        {Array.from({ length: totalSamples }).map((_, i) => {
          const sample = samples[i];
          const isCompleted = sample && sample.quality?.acceptable;
          const isCurrent = i === currentSample;
          const isFailed = sample && !sample.quality?.acceptable;

          return (
            <div
              key={i}
              className={`progress-dot ${isCompleted ? 'completed' : ''} ${
                isCurrent ? 'current' : ''
              } ${isFailed ? 'failed' : ''}`}
            >
              {isCompleted && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
              {isFailed && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              )}
              {!isCompleted && !isFailed && <span>{i + 1}</span>}
            </div>
          );
        })}
      </div>
      <p className="progress-text">
        Sample {Math.min(currentSample + 1, totalSamples)} of {totalSamples}
      </p>
    </div>
  );
};

/**
 * Countdown overlay
 */
const CountdownOverlay: React.FC<{ count: number; phrase: string }> = ({ count, phrase }) => {
  return (
    <div className="countdown-overlay">
      <div className="countdown-circle">
        <span className="countdown-number">{count}</span>
      </div>
      <p className="countdown-instruction">
        Get ready to say: <strong>&quot;{phrase}&quot;</strong>
      </p>
    </div>
  );
};

/**
 * Quality feedback display
 */
const QualityFeedback: React.FC<{ quality: RecordingQuality }> = ({ quality }) => {
  const getScoreColor = () => {
    if (quality.score >= 0.8) return 'excellent';
    if (quality.score >= 0.6) return 'good';
    if (quality.score >= 0.4) return 'fair';
    return 'poor';
  };

  return (
    <div className={`quality-feedback ${getScoreColor()}`}>
      <div className="quality-header">
        <span className="quality-label">Recording Quality</span>
        <span className="quality-score">{Math.round(quality.score * 100)}%</span>
      </div>
      <div className="quality-bar">
        <div className="quality-fill" style={{ width: `${quality.score * 100}%` }} />
      </div>
      {quality.suggestions.length > 0 && (
        <div className="quality-suggestions">
          {quality.suggestions.map((suggestion, i) => (
            <p key={i} className="suggestion-text">
              {suggestion}
            </p>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Model list item
 */
const ModelListItem: React.FC<{
  model: CustomWakeWordModel;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  isSelected: boolean;
}> = ({ model, onSelect, onDelete, isSelected }) => {
  return (
    <div className={`model-list-item ${isSelected ? 'selected' : ''}`}>
      <div className="model-info" onClick={() => onSelect(model.id)}>
        <div className="model-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
        </div>
        <div className="model-details">
          <span className="model-name">{model.displayName}</span>
          <span className="model-date">
            Created {new Date(model.createdAt).toLocaleDateString()}
          </span>
        </div>
        {isSelected && (
          <div className="model-active-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Active
          </div>
        )}
      </div>
      <button
        className="model-delete-btn"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(model.id);
        }}
        title="Delete model"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>
    </div>
  );
};

// ============================================================================
// Built-in Wake Word Options
// ============================================================================

const BUILT_IN_KEYWORDS = [
  { id: 'jarvis', name: 'Jarvis', description: 'Classic AI assistant name' },
  { id: 'computer', name: 'Computer', description: 'Star Trek inspired' },
  { id: 'hey siri', name: 'Hey Siri', description: 'Apple-style wake phrase' },
  { id: 'alexa', name: 'Alexa', description: 'Amazon-style wake word' },
  { id: 'picovoice', name: 'Picovoice', description: 'Porcupine default' },
  { id: 'bumblebee', name: 'Bumblebee', description: 'Unique wake word' },
  { id: 'terminator', name: 'Terminator', description: 'For Skynet enthusiasts' },
];

// ============================================================================
// Main Component
// ============================================================================

interface WakeWordSetupProps {
  onComplete?: () => void;
  onClose?: () => void;
  initialTab?: 'custom' | 'builtin';
}

export const WakeWordSetup: React.FC<WakeWordSetupProps> = ({
  onComplete,
  onClose,
  initialTab = 'custom',
}) => {
  // State
  const [activeTab, setActiveTab] = useState<'custom' | 'builtin'>(initialTab);
  const [customPhrase, setCustomPhrase] = useState('Hey Atlas');
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [session, setSession] = useState<TrainingSession | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [lastQuality, setLastQuality] = useState<RecordingQuality | null>(null);
  const [customModels, setCustomModels] = useState<CustomWakeWordModel[]>([]);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [selectedBuiltIn, setSelectedBuiltIn] = useState<string>('jarvis');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Refs
  const cleanupRef = useRef<(() => void) | null>(null);

  // Load custom models on mount
  useEffect(() => {
    loadCustomModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Set up IPC event listeners
  useEffect(() => {
    const unsubscribers: (() => void)[] = [];

    // Listen for training progress
    const progressUnsub = window.atlas?.on('atlas:training-progress', (event: unknown) => {
      const progress = event as TrainingProgressEvent;
      setRecordingState(progress.state as RecordingState);

      if (progress.countdown !== undefined) {
        setCountdown(progress.countdown);
      }
      if (progress.audioLevel !== undefined) {
        setAudioLevel(progress.audioLevel);
      }
      if (progress.message) {
        setProgressMessage(progress.message);
      }
    });
    if (progressUnsub) unsubscribers.push(progressUnsub);

    // Listen for audio level during recording
    const audioUnsub = window.atlas?.on('atlas:training-audio-level', (level: unknown) => {
      setAudioLevel(level as number);
    });
    if (audioUnsub) unsubscribers.push(audioUnsub);

    // Listen for sample completion
    const sampleUnsub = window.atlas?.on('atlas:training-sample-complete', (data: unknown) => {
      const { sample, session: updatedSession } = data as {
        sample: TrainingSample;
        session: TrainingSession;
      };
      setSession(updatedSession);
      if (sample.quality) {
        setLastQuality(sample.quality);
      }
    });
    if (sampleUnsub) unsubscribers.push(sampleUnsub);

    // Listen for session completion
    const sessionUnsub = window.atlas?.on('atlas:training-session-complete', (data: unknown) => {
      const updatedSession = data as TrainingSession;
      setSession(updatedSession);
      setRecordingState('complete');
      loadCustomModels();
    });
    if (sessionUnsub) unsubscribers.push(sessionUnsub);

    // Listen for errors
    const errorUnsub = window.atlas?.on('atlas:training-error', (data: unknown) => {
      const { message } = data as { message: string };
      setError(message);
      setRecordingState('error');
    });
    if (errorUnsub) unsubscribers.push(errorUnsub);

    // Store cleanup function
    cleanupRef.current = () => {
      unsubscribers.forEach((unsub) => unsub());
    };

    return () => {
      cleanupRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load custom wake word models
  const loadCustomModels = useCallback(async () => {
    try {
      const result = await window.atlas?.invoke<{
        success: boolean;
        data?: { models: CustomWakeWordModel[]; activeId: string | null };
        error?: string;
      }>('wake-word:get-custom-models');

      if (result?.success && result.data) {
        setCustomModels(result.data.models);
        setActiveModelId(result.data.activeId);
      }
    } catch (err) {
      console.error('Failed to load custom models:', err);
    }
  }, []);

  // Start training session
  const startTraining = useCallback(async () => {
    if (!customPhrase.trim()) {
      setError('Please enter a wake phrase');
      return;
    }

    setError(null);
    setIsLoading(true);
    setLastQuality(null);

    try {
      const result = await window.atlas?.invoke<{
        success: boolean;
        data?: TrainingSession;
        error?: string;
      }>('wake-word:start-training', customPhrase.trim());

      if (result?.success && result.data) {
        setSession(result.data);
        setRecordingState('preparing');
        setProgressMessage('Training session started. Click "Record" when ready.');
      } else {
        setError(result?.error || 'Failed to start training session');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start training');
    } finally {
      setIsLoading(false);
    }
  }, [customPhrase]);

  // Start recording a sample
  const startRecording = useCallback(async () => {
    if (!session) {
      setError('No active training session');
      return;
    }

    setError(null);
    setLastQuality(null);

    try {
      await window.atlas?.invoke('wake-word:start-recording');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start recording');
    }
  }, [session]);

  // Stop recording
  const stopRecording = useCallback(async () => {
    try {
      await window.atlas?.invoke('wake-word:stop-recording');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop recording');
    }
  }, []);

  // Cancel training session
  const cancelTraining = useCallback(async () => {
    try {
      await window.atlas?.invoke('wake-word:cancel-training');
      setSession(null);
      setRecordingState('idle');
      setProgressMessage('');
      setLastQuality(null);
    } catch (err) {
      console.error('Failed to cancel training:', err);
    }
  }, []);

  // Activate a custom model
  const activateModel = useCallback(
    async (modelId: string) => {
      try {
        const result = await window.atlas?.invoke<{ success: boolean; error?: string }>(
          'wake-word:set-active-model',
          modelId
        );

        if (result?.success) {
          setActiveModelId(modelId);
          loadCustomModels();
        } else {
          setError(result?.error || 'Failed to activate model');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to activate model');
      }
    },
    [loadCustomModels]
  );

  // Delete a custom model
  const deleteModel = useCallback(
    async (modelId: string) => {
      if (!confirm('Are you sure you want to delete this wake word model?')) {
        return;
      }

      try {
        const result = await window.atlas?.invoke<{ success: boolean; error?: string }>(
          'wake-word:delete-model',
          modelId
        );

        if (result?.success) {
          if (activeModelId === modelId) {
            setActiveModelId(null);
          }
          loadCustomModels();
        } else {
          setError(result?.error || 'Failed to delete model');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete model');
      }
    },
    [activeModelId, loadCustomModels]
  );

  // Select a built-in keyword
  const selectBuiltIn = useCallback(async (keywordId: string) => {
    setSelectedBuiltIn(keywordId);

    try {
      const result = await window.atlas?.invoke<{ success: boolean; error?: string }>(
        'wake-word:set-builtin-keyword',
        keywordId
      );

      if (!result?.success) {
        setError(result?.error || 'Failed to set built-in keyword');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set keyword');
    }
  }, []);

  // Import model from file
  const importModel = useCallback(async () => {
    try {
      const result = await window.atlas?.invoke<{
        success: boolean;
        data?: CustomWakeWordModel;
        error?: string;
      }>('wake-word:import-model');

      if (result?.success && result.data) {
        loadCustomModels();
        setProgressMessage(`Imported "${result.data.displayName}" successfully!`);
      } else if (result?.error) {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import model');
    }
  }, [loadCustomModels]);

  // Export samples for manual training
  const exportSamples = useCallback(async () => {
    if (!session || session.samples.length === 0) {
      setError('No samples to export');
      return;
    }

    try {
      const result = await window.atlas?.invoke<{
        success: boolean;
        data?: { exportPath: string };
        error?: string;
      }>('wake-word:export-samples');

      if (result?.success && result.data) {
        setProgressMessage(`Samples exported to: ${result.data.exportPath}`);
      } else {
        setError(result?.error || 'Failed to export samples');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export samples');
    }
  }, [session]);

  // Render the recording interface
  const renderRecordingInterface = () => {
    if (!session) {
      return (
        <div className="training-start">
          <div className="phrase-input-group">
            <label htmlFor="wake-phrase">Custom Wake Phrase</label>
            <input
              id="wake-phrase"
              type="text"
              value={customPhrase}
              onChange={(e) => setCustomPhrase(e.target.value)}
              placeholder="Enter your wake phrase..."
              maxLength={50}
              disabled={isLoading}
            />
            <span className="char-count">{customPhrase.length}/50</span>
          </div>

          <div className="training-info">
            <h4>Training Process</h4>
            <ol>
              <li>Enter your desired wake phrase above</li>
              <li>Record 3 clear samples of the phrase</li>
              <li>Each sample will be validated for quality</li>
              <li>Import the trained model from Picovoice Console</li>
            </ol>
            <p className="training-note">
              <strong>Note:</strong> After recording samples, you will need to train them using
              Picovoice Console and import the resulting model.
            </p>
          </div>

          <button
            className="start-training-btn"
            onClick={startTraining}
            disabled={isLoading || !customPhrase.trim()}
          >
            {isLoading ? 'Starting...' : 'Start Training'}
          </button>
        </div>
      );
    }

    return (
      <div className="training-interface">
        <div className="training-header">
          <h3>Recording: &quot;{session.phrase}&quot;</h3>
          <RecordingProgress
            currentSample={session.currentSampleIndex}
            totalSamples={session.requiredSamples}
            samples={session.samples}
          />
        </div>

        <div className="recording-area">
          {recordingState === 'countdown' && (
            <CountdownOverlay count={countdown} phrase={session.phrase} />
          )}

          <div className={`recording-orb ${recordingState === 'recording' ? 'recording' : ''}`}>
            <div className="orb-pulse" />
            <div className="orb-core">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            </div>
          </div>

          <AudioLevelMeter level={audioLevel} isRecording={recordingState === 'recording'} />

          <p className="recording-message">{progressMessage}</p>
        </div>

        {lastQuality && <QualityFeedback quality={lastQuality} />}

        <div className="recording-controls">
          {(recordingState === 'idle' || recordingState === 'preparing') && (
            <button className="record-btn primary" onClick={startRecording}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="10" />
              </svg>
              Record Sample {session.currentSampleIndex + 1}
            </button>
          )}

          {recordingState === 'recording' && (
            <button className="stop-btn" onClick={stopRecording}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              Stop Recording
            </button>
          )}

          {recordingState === 'complete' && (
            <div className="complete-actions">
              <p className="success-message">All samples recorded successfully!</p>
              <button className="export-btn" onClick={exportSamples}>
                Export for Training
              </button>
              <button className="import-btn" onClick={importModel}>
                Import Trained Model
              </button>
            </div>
          )}

          <button className="cancel-btn text" onClick={cancelTraining}>
            Cancel Training
          </button>
        </div>
      </div>
    );
  };

  // Render custom models list
  const renderCustomModels = () => (
    <div className="custom-models-section">
      <div className="section-header">
        <h4>Your Custom Wake Words</h4>
        <button className="import-model-btn" onClick={importModel}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" x2="12" y1="3" y2="15" />
          </svg>
          Import Model
        </button>
      </div>

      {customModels.length === 0 ? (
        <div className="empty-models">
          <p>No custom wake words yet.</p>
          <p>Train a new one above or import an existing model.</p>
        </div>
      ) : (
        <div className="models-list">
          {customModels.map((model) => (
            <ModelListItem
              key={model.id}
              model={model}
              isSelected={model.id === activeModelId}
              onSelect={activateModel}
              onDelete={deleteModel}
            />
          ))}
        </div>
      )}
    </div>
  );

  // Render built-in keywords selection
  const renderBuiltInKeywords = () => (
    <div className="builtin-keywords-section">
      <p className="section-description">
        Select a built-in wake word. These work out of the box with no training required.
      </p>

      <div className="keywords-grid">
        {BUILT_IN_KEYWORDS.map((keyword) => (
          <button
            key={keyword.id}
            className={`keyword-card ${selectedBuiltIn === keyword.id ? 'selected' : ''}`}
            onClick={() => selectBuiltIn(keyword.id)}
          >
            <span className="keyword-name">{keyword.name}</span>
            <span className="keyword-description">{keyword.description}</span>
            {selectedBuiltIn === keyword.id && (
              <svg
                className="check-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="wake-word-setup">
      <div className="setup-header">
        <h2>Wake Word Setup</h2>
        {onClose && (
          <button className="close-btn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      <div className="tab-navigation">
        <button
          className={`tab-btn ${activeTab === 'custom' ? 'active' : ''}`}
          onClick={() => setActiveTab('custom')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
          Custom Wake Word
        </button>
        <button
          className={`tab-btn ${activeTab === 'builtin' ? 'active' : ''}`}
          onClick={() => setActiveTab('builtin')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
          Built-in Keywords
        </button>
      </div>

      {error && (
        <div className="error-banner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      <div className="tab-content">
        {activeTab === 'custom' && (
          <div className="custom-tab">
            {renderRecordingInterface()}
            {!session && renderCustomModels()}
          </div>
        )}

        {activeTab === 'builtin' && renderBuiltInKeywords()}
      </div>

      {onComplete && (
        <div className="setup-footer">
          <button className="complete-btn primary" onClick={onComplete}>
            Done
          </button>
        </div>
      )}

      <style>{`
        .wake-word-setup {
          padding: 24px;
          max-width: 600px;
          margin: 0 auto;
        }

        .setup-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }

        .setup-header h2 {
          margin: 0;
          font-size: 1.5rem;
          font-weight: 600;
        }

        .close-btn {
          background: none;
          border: none;
          padding: 8px;
          cursor: pointer;
          color: var(--text-secondary, #888);
          border-radius: 8px;
        }

        .close-btn:hover {
          background: var(--bg-hover, rgba(255,255,255,0.1));
        }

        .close-btn svg {
          width: 20px;
          height: 20px;
        }

        .tab-navigation {
          display: flex;
          gap: 8px;
          margin-bottom: 24px;
          border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.1));
          padding-bottom: 8px;
        }

        .tab-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          border: none;
          background: none;
          cursor: pointer;
          font-size: 0.9rem;
          color: var(--text-secondary, #888);
          border-radius: 8px;
          transition: all 0.2s;
        }

        .tab-btn:hover {
          background: var(--bg-hover, rgba(255,255,255,0.05));
          color: var(--text-primary, #fff);
        }

        .tab-btn.active {
          background: var(--accent-color, #6366f1);
          color: white;
        }

        .tab-btn svg {
          width: 18px;
          height: 18px;
        }

        .error-banner {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: 8px;
          margin-bottom: 16px;
          color: #ef4444;
        }

        .error-banner svg {
          width: 20px;
          height: 20px;
          flex-shrink: 0;
        }

        .error-banner span {
          flex: 1;
        }

        .error-banner button {
          background: none;
          border: none;
          padding: 4px;
          cursor: pointer;
          color: inherit;
        }

        /* Training Start */
        .training-start {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .phrase-input-group {
          position: relative;
        }

        .phrase-input-group label {
          display: block;
          margin-bottom: 8px;
          font-weight: 500;
          color: var(--text-primary, #fff);
        }

        .phrase-input-group input {
          width: 100%;
          padding: 12px 60px 12px 16px;
          border: 1px solid var(--border-color, rgba(255,255,255,0.2));
          border-radius: 8px;
          background: var(--bg-input, rgba(255,255,255,0.05));
          color: var(--text-primary, #fff);
          font-size: 1rem;
        }

        .phrase-input-group input:focus {
          outline: none;
          border-color: var(--accent-color, #6366f1);
        }

        .char-count {
          position: absolute;
          right: 12px;
          bottom: 12px;
          font-size: 0.75rem;
          color: var(--text-secondary, #888);
        }

        .training-info {
          background: var(--bg-secondary, rgba(255,255,255,0.05));
          border-radius: 8px;
          padding: 16px;
        }

        .training-info h4 {
          margin: 0 0 12px;
          font-size: 0.9rem;
          font-weight: 600;
        }

        .training-info ol {
          margin: 0;
          padding-left: 20px;
        }

        .training-info li {
          margin-bottom: 8px;
          color: var(--text-secondary, #ccc);
        }

        .training-note {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--border-color, rgba(255,255,255,0.1));
          font-size: 0.85rem;
          color: var(--text-secondary, #888);
        }

        .start-training-btn {
          padding: 14px 24px;
          border: none;
          border-radius: 8px;
          background: var(--accent-color, #6366f1);
          color: white;
          font-size: 1rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .start-training-btn:hover:not(:disabled) {
          background: var(--accent-hover, #4f46e5);
        }

        .start-training-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* Recording Interface */
        .training-interface {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .training-header {
          text-align: center;
        }

        .training-header h3 {
          margin: 0 0 16px;
          font-size: 1.1rem;
          color: var(--text-primary, #fff);
        }

        .recording-progress {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .progress-dots {
          display: flex;
          gap: 16px;
        }

        .progress-dot {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: 2px solid var(--border-color, rgba(255,255,255,0.2));
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.9rem;
          color: var(--text-secondary, #888);
          transition: all 0.3s;
        }

        .progress-dot.current {
          border-color: var(--accent-color, #6366f1);
          color: var(--accent-color, #6366f1);
        }

        .progress-dot.completed {
          background: var(--success-color, #22c55e);
          border-color: var(--success-color, #22c55e);
          color: white;
        }

        .progress-dot.failed {
          background: rgba(239, 68, 68, 0.2);
          border-color: #ef4444;
          color: #ef4444;
        }

        .progress-dot svg {
          width: 20px;
          height: 20px;
        }

        .progress-text {
          font-size: 0.85rem;
          color: var(--text-secondary, #888);
        }

        .recording-area {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 20px;
          padding: 24px;
          background: var(--bg-secondary, rgba(255,255,255,0.03));
          border-radius: 12px;
          position: relative;
        }

        .recording-orb {
          width: 120px;
          height: 120px;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--accent-color, #6366f1), #8b5cf6);
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }

        .recording-orb.recording .orb-pulse {
          animation: pulse 1.5s infinite;
        }

        @keyframes pulse {
          0% {
            transform: scale(1);
            opacity: 0.5;
          }
          50% {
            transform: scale(1.4);
            opacity: 0;
          }
          100% {
            transform: scale(1);
            opacity: 0.5;
          }
        }

        .orb-pulse {
          position: absolute;
          inset: -10px;
          border-radius: 50%;
          background: var(--accent-color, #6366f1);
          opacity: 0;
        }

        .orb-core {
          width: 60px;
          height: 60px;
          background: rgba(255,255,255,0.9);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--accent-color, #6366f1);
        }

        .orb-core svg {
          width: 32px;
          height: 32px;
        }

        .recording-message {
          text-align: center;
          color: var(--text-primary, #fff);
          font-size: 0.95rem;
          min-height: 24px;
        }

        /* Audio Level Meter */
        .audio-level-meter {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .level-bars {
          display: flex;
          gap: 3px;
          height: 40px;
          align-items: flex-end;
        }

        .level-bar {
          width: 8px;
          height: 100%;
          background: var(--accent-color, #6366f1);
          border-radius: 2px;
          transition: transform 0.05s, opacity 0.1s;
        }

        .level-bar.medium {
          background: #f59e0b;
        }

        .level-bar.high {
          background: #ef4444;
        }

        .level-label {
          min-width: 40px;
          text-align: right;
          font-size: 0.85rem;
          color: var(--text-secondary, #888);
        }

        /* Countdown */
        .countdown-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0,0,0,0.8);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 16px;
          border-radius: 12px;
          z-index: 10;
        }

        .countdown-circle {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          background: var(--accent-color, #6366f1);
          display: flex;
          align-items: center;
          justify-content: center;
          animation: countdown-pulse 1s infinite;
        }

        @keyframes countdown-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }

        .countdown-number {
          font-size: 2.5rem;
          font-weight: 700;
          color: white;
        }

        .countdown-instruction {
          color: white;
          font-size: 0.95rem;
          text-align: center;
        }

        /* Quality Feedback */
        .quality-feedback {
          padding: 16px;
          background: var(--bg-secondary, rgba(255,255,255,0.05));
          border-radius: 8px;
        }

        .quality-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .quality-label {
          font-weight: 500;
        }

        .quality-score {
          font-weight: 600;
        }

        .quality-feedback.excellent .quality-score { color: #22c55e; }
        .quality-feedback.good .quality-score { color: #84cc16; }
        .quality-feedback.fair .quality-score { color: #f59e0b; }
        .quality-feedback.poor .quality-score { color: #ef4444; }

        .quality-bar {
          height: 6px;
          background: var(--bg-tertiary, rgba(255,255,255,0.1));
          border-radius: 3px;
          overflow: hidden;
        }

        .quality-fill {
          height: 100%;
          transition: width 0.5s;
        }

        .quality-feedback.excellent .quality-fill { background: #22c55e; }
        .quality-feedback.good .quality-fill { background: #84cc16; }
        .quality-feedback.fair .quality-fill { background: #f59e0b; }
        .quality-feedback.poor .quality-fill { background: #ef4444; }

        .quality-suggestions {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--border-color, rgba(255,255,255,0.1));
        }

        .suggestion-text {
          margin: 0 0 4px;
          font-size: 0.85rem;
          color: var(--text-secondary, #888);
        }

        /* Recording Controls */
        .recording-controls {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }

        .record-btn, .stop-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 14px 28px;
          border: none;
          border-radius: 24px;
          font-size: 1rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .record-btn.primary {
          background: var(--accent-color, #6366f1);
          color: white;
        }

        .record-btn.primary:hover {
          background: var(--accent-hover, #4f46e5);
        }

        .record-btn svg, .stop-btn svg {
          width: 20px;
          height: 20px;
        }

        .stop-btn {
          background: #ef4444;
          color: white;
        }

        .stop-btn:hover {
          background: #dc2626;
        }

        .cancel-btn {
          background: none;
          border: none;
          padding: 8px 16px;
          cursor: pointer;
          color: var(--text-secondary, #888);
          font-size: 0.9rem;
        }

        .cancel-btn:hover {
          color: var(--text-primary, #fff);
        }

        .complete-actions {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }

        .success-message {
          color: #22c55e;
          font-weight: 500;
        }

        .export-btn, .import-btn {
          padding: 12px 24px;
          border: none;
          border-radius: 8px;
          font-size: 0.9rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .export-btn {
          background: var(--bg-secondary, rgba(255,255,255,0.1));
          color: var(--text-primary, #fff);
        }

        .export-btn:hover {
          background: var(--bg-hover, rgba(255,255,255,0.15));
        }

        .import-btn {
          background: var(--accent-color, #6366f1);
          color: white;
        }

        .import-btn:hover {
          background: var(--accent-hover, #4f46e5);
        }

        /* Custom Models Section */
        .custom-models-section {
          margin-top: 32px;
          padding-top: 24px;
          border-top: 1px solid var(--border-color, rgba(255,255,255,0.1));
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }

        .section-header h4 {
          margin: 0;
          font-size: 1rem;
          font-weight: 600;
        }

        .import-model-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          border: 1px solid var(--border-color, rgba(255,255,255,0.2));
          border-radius: 6px;
          background: none;
          color: var(--text-secondary, #888);
          font-size: 0.85rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .import-model-btn:hover {
          background: var(--bg-hover, rgba(255,255,255,0.05));
          color: var(--text-primary, #fff);
        }

        .import-model-btn svg {
          width: 16px;
          height: 16px;
        }

        .empty-models {
          padding: 32px;
          text-align: center;
          color: var(--text-secondary, #888);
        }

        .empty-models p {
          margin: 4px 0;
        }

        .models-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .model-list-item {
          display: flex;
          align-items: center;
          padding: 12px;
          background: var(--bg-secondary, rgba(255,255,255,0.05));
          border: 1px solid transparent;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .model-list-item:hover {
          background: var(--bg-hover, rgba(255,255,255,0.08));
        }

        .model-list-item.selected {
          border-color: var(--accent-color, #6366f1);
          background: rgba(99, 102, 241, 0.1);
        }

        .model-info {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1;
        }

        .model-icon {
          width: 40px;
          height: 40px;
          background: var(--bg-tertiary, rgba(255,255,255,0.1));
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--accent-color, #6366f1);
        }

        .model-icon svg {
          width: 20px;
          height: 20px;
        }

        .model-details {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .model-name {
          font-weight: 500;
          color: var(--text-primary, #fff);
        }

        .model-date {
          font-size: 0.8rem;
          color: var(--text-secondary, #888);
        }

        .model-active-badge {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          background: var(--accent-color, #6366f1);
          border-radius: 4px;
          font-size: 0.75rem;
          color: white;
        }

        .model-active-badge svg {
          width: 12px;
          height: 12px;
        }

        .model-delete-btn {
          padding: 8px;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-secondary, #888);
          border-radius: 6px;
          opacity: 0;
          transition: all 0.2s;
        }

        .model-list-item:hover .model-delete-btn {
          opacity: 1;
        }

        .model-delete-btn:hover {
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
        }

        .model-delete-btn svg {
          width: 18px;
          height: 18px;
        }

        /* Built-in Keywords */
        .builtin-keywords-section {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .section-description {
          color: var(--text-secondary, #888);
          font-size: 0.95rem;
        }

        .keywords-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 12px;
        }

        .keyword-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 16px;
          background: var(--bg-secondary, rgba(255,255,255,0.05));
          border: 2px solid transparent;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
          text-align: center;
        }

        .keyword-card:hover {
          background: var(--bg-hover, rgba(255,255,255,0.08));
        }

        .keyword-card.selected {
          border-color: var(--accent-color, #6366f1);
          background: rgba(99, 102, 241, 0.1);
        }

        .keyword-name {
          font-weight: 600;
          color: var(--text-primary, #fff);
        }

        .keyword-description {
          font-size: 0.8rem;
          color: var(--text-secondary, #888);
        }

        .keyword-card .check-icon {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 16px;
          height: 16px;
          color: var(--accent-color, #6366f1);
        }

        /* Footer */
        .setup-footer {
          margin-top: 24px;
          padding-top: 24px;
          border-top: 1px solid var(--border-color, rgba(255,255,255,0.1));
          display: flex;
          justify-content: flex-end;
        }

        .complete-btn {
          padding: 12px 32px;
          border: none;
          border-radius: 8px;
          font-size: 1rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .complete-btn.primary {
          background: var(--accent-color, #6366f1);
          color: white;
        }

        .complete-btn.primary:hover {
          background: var(--accent-hover, #4f46e5);
        }
      `}</style>
    </div>
  );
};

export default WakeWordSetup;
