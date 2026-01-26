/**
 * Atlas Desktop - Custom Wake Words Component
 * Train and manage custom wake words for activating Atlas
 */

import { useState, useEffect, useCallback } from 'react';
import './CustomWakeWords.css';

interface CustomWakeWordsProps {
  isVisible: boolean;
  onClose: () => void;
}

interface WakeWord {
  id: string;
  phrase: string;
  enabled: boolean;
  samples: number;
  minSamples: number;
  accuracy: number;
  isDefault: boolean;
  createdAt: number;
}

interface WakeWordSettings {
  sensitivityLevel: number;
  cooldownMs: number;
  requireConfirmation: boolean;
  playSound: boolean;
}

export function CustomWakeWords({ isVisible, onClose }: CustomWakeWordsProps) {
  const [wakeWords, setWakeWords] = useState<WakeWord[]>([
    {
      id: 'default-atlas',
      phrase: 'Hey Atlas',
      enabled: true,
      samples: 50,
      minSamples: 5,
      accuracy: 0.95,
      isDefault: true,
      createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    },
    {
      id: 'default-computer',
      phrase: 'Computer',
      enabled: false,
      samples: 50,
      minSamples: 5,
      accuracy: 0.92,
      isDefault: true,
      createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    },
    {
      id: 'custom-1',
      phrase: 'Jarvis',
      enabled: true,
      samples: 8,
      minSamples: 5,
      accuracy: 0.78,
      isDefault: false,
      createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
    },
  ]);

  const [settings, setSettings] = useState<WakeWordSettings>({
    sensitivityLevel: 0.7,
    cooldownMs: 2000,
    requireConfirmation: false,
    playSound: true,
  });

  const [isRecording, setIsRecording] = useState(false);
  const [recordingWordId, setRecordingWordId] = useState<string | null>(null);
  const [_recordingProgress, setRecordingProgress] = useState(0);
  const [newPhraseInput, setNewPhraseInput] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);

  // Load settings
  useEffect(() => {
    try {
      const savedWords = localStorage.getItem('atlas-wake-words');
      const savedSettings = localStorage.getItem('atlas-wake-settings');
      if (savedWords) setWakeWords(JSON.parse(savedWords));
      if (savedSettings) setSettings(JSON.parse(savedSettings));
    } catch (err) {
      console.error('Failed to load wake word settings:', err);
    }
  }, []);

  // Save settings
  useEffect(() => {
    localStorage.setItem('atlas-wake-words', JSON.stringify(wakeWords));
    localStorage.setItem('atlas-wake-settings', JSON.stringify(settings));
  }, [wakeWords, settings]);

  const handleClose = useCallback(() => {
    if (isRecording) {
      setIsRecording(false);
      setRecordingWordId(null);
      setRecordingProgress(0);
    }
    onClose();
  }, [onClose, isRecording]);

  useEffect(() => {
    if (!isVisible) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isVisible, handleClose]);

  // Simulate recording progress
  useEffect(() => {
    if (!isRecording || !recordingWordId) return;

    const interval = setInterval(() => {
      setRecordingProgress(prev => {
        if (prev >= 100) {
          // Recording complete
          setIsRecording(false);
          setRecordingWordId(null);
          setWakeWords(words => words.map(w =>
            w.id === recordingWordId
              ? { ...w, samples: w.samples + 1, accuracy: Math.min(0.98, w.accuracy + 0.02) }
              : w
          ));
          return 0;
        }
        return prev + 20;
      });
    }, 500);

    return () => clearInterval(interval);
  }, [isRecording, recordingWordId]);

  const startRecording = (wordId: string) => {
    setRecordingWordId(wordId);
    setIsRecording(true);
    setRecordingProgress(0);
  };

  const stopRecording = () => {
    setIsRecording(false);
    setRecordingWordId(null);
    setRecordingProgress(0);
  };

  const toggleWakeWord = (wordId: string) => {
    setWakeWords(words => words.map(w =>
      w.id === wordId ? { ...w, enabled: !w.enabled } : w
    ));
  };

  const deleteWakeWord = (wordId: string) => {
    setWakeWords(words => words.filter(w => w.id !== wordId));
  };

  const addWakeWord = () => {
    if (!newPhraseInput.trim()) return;

    const newWord: WakeWord = {
      id: `custom-${Date.now()}`,
      phrase: newPhraseInput.trim(),
      enabled: false,
      samples: 0,
      minSamples: 5,
      accuracy: 0,
      isDefault: false,
      createdAt: Date.now(),
    };

    setWakeWords(words => [...words, newWord]);
    setNewPhraseInput('');
    setShowAddDialog(false);
  };

  const getAccuracyColor = (accuracy: number) => {
    if (accuracy >= 0.9) return '#10b981';
    if (accuracy >= 0.7) return '#fbbf24';
    return '#ef4444';
  };

  const getStatusText = (word: WakeWord) => {
    if (word.samples < word.minSamples) {
      return `${word.samples}/${word.minSamples} samples needed`;
    }
    return `${Math.round(word.accuracy * 100)}% accuracy`;
  };

  if (!isVisible) return null;

  return (
    <div className="wakework-overlay" onClick={handleClose}>
      <div className="wakeword-container" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="ww-header">
          <div className="ww-title-row">
            <svg className="ww-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
              <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
            </svg>
            <h2>Custom Wake Words</h2>
          </div>
          <button className="ww-close" onClick={handleClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="ww-content">
          {/* Wake Words List */}
          <div className="ww-section">
            <div className="ww-section-header">
              <h3>Wake Words</h3>
              <button className="ww-add-btn" onClick={() => setShowAddDialog(true)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add Custom
              </button>
            </div>

            <div className="ww-words-list">
              {wakeWords.map(word => (
                <div
                  key={word.id}
                  className={`ww-word-card ${word.enabled ? 'enabled' : ''} ${recordingWordId === word.id ? 'recording' : ''}`}
                >
                  <div className="ww-word-toggle">
                    <label className="ww-toggle">
                      <input
                        type="checkbox"
                        checked={word.enabled}
                        onChange={() => toggleWakeWord(word.id)}
                        disabled={word.samples < word.minSamples}
                      />
                      <span className="ww-toggle-slider"></span>
                    </label>
                  </div>

                  <div className="ww-word-info">
                    <div className="ww-word-phrase">
                      "{word.phrase}"
                      {word.isDefault && <span className="ww-default-badge">Default</span>}
                    </div>
                    <div className="ww-word-status">
                      <span
                        className="ww-accuracy"
                        style={{ color: getAccuracyColor(word.accuracy) }}
                      >
                        {getStatusText(word)}
                      </span>
                      {word.samples > 0 && (
                        <span className="ww-samples">{word.samples} samples</span>
                      )}
                    </div>
                  </div>

                  <div className="ww-word-actions">
                    {recordingWordId === word.id ? (
                      <div className="ww-recording-indicator">
                        <div className="ww-recording-wave">
                          <span></span><span></span><span></span><span></span><span></span>
                        </div>
                        <button className="ww-stop-btn" onClick={stopRecording}>
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="6" width="12" height="12" rx="2" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          className="ww-train-btn"
                          onClick={() => startRecording(word.id)}
                          title="Record more samples"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                            <path d="M19 10v2a7 7 0 01-14 0v-2" />
                          </svg>
                          Train
                        </button>
                        {!word.isDefault && (
                          <button
                            className="ww-delete-btn"
                            onClick={() => deleteWakeWord(word.id)}
                            title="Delete wake word"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                            </svg>
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Settings */}
          <div className="ww-section">
            <h3>Detection Settings</h3>

            <div className="ww-setting-row">
              <label>Sensitivity</label>
              <div className="ww-slider-control">
                <span className="ww-slider-label">Low</span>
                <input
                  type="range"
                  min="0.3"
                  max="0.95"
                  step="0.05"
                  value={settings.sensitivityLevel}
                  onChange={e => setSettings(prev => ({ ...prev, sensitivityLevel: Number(e.target.value) }))}
                />
                <span className="ww-slider-label">High</span>
                <span className="ww-slider-value">{Math.round(settings.sensitivityLevel * 100)}%</span>
              </div>
            </div>

            <div className="ww-setting-row">
              <label>Cooldown</label>
              <div className="ww-slider-control">
                <input
                  type="range"
                  min="500"
                  max="5000"
                  step="500"
                  value={settings.cooldownMs}
                  onChange={e => setSettings(prev => ({ ...prev, cooldownMs: Number(e.target.value) }))}
                />
                <span className="ww-slider-value">{settings.cooldownMs / 1000}s</span>
              </div>
            </div>

            <div className="ww-checkboxes">
              <label className="ww-checkbox">
                <input
                  type="checkbox"
                  checked={settings.playSound}
                  onChange={e => setSettings(prev => ({ ...prev, playSound: e.target.checked }))}
                />
                <span className="ww-checkmark"></span>
                <span>Play confirmation sound when activated</span>
              </label>
              <label className="ww-checkbox">
                <input
                  type="checkbox"
                  checked={settings.requireConfirmation}
                  onChange={e => setSettings(prev => ({ ...prev, requireConfirmation: e.target.checked }))}
                />
                <span className="ww-checkmark"></span>
                <span>Require visual confirmation before listening</span>
              </label>
            </div>
          </div>

          {/* Tips */}
          <div className="ww-tips">
            <h4>Training Tips</h4>
            <ul>
              <li>Record at least 5 samples for reliable detection</li>
              <li>Vary your tone, speed, and distance from the microphone</li>
              <li>Record in different environments (quiet, noisy)</li>
              <li>More samples improve accuracy over time</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="ww-footer">
          <div className="ww-footer-info">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            <span>
              {wakeWords.filter(w => w.enabled).length} wake word{wakeWords.filter(w => w.enabled).length !== 1 ? 's' : ''} active
            </span>
          </div>
        </div>

        {/* Add Dialog */}
        {showAddDialog && (
          <div className="ww-dialog-overlay" onClick={() => setShowAddDialog(false)}>
            <div className="ww-dialog" onClick={e => e.stopPropagation()}>
              <h3>Add Custom Wake Word</h3>
              <p>Enter a phrase to use as a wake word. You will need to record at least 5 samples.</p>
              <input
                type="text"
                placeholder="Enter wake phrase (e.g., 'Hey Buddy')"
                value={newPhraseInput}
                onChange={e => setNewPhraseInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addWakeWord()}
                autoFocus
              />
              <div className="ww-dialog-actions">
                <button className="ww-dialog-cancel" onClick={() => setShowAddDialog(false)}>
                  Cancel
                </button>
                <button className="ww-dialog-confirm" onClick={addWakeWord} disabled={!newPhraseInput.trim()}>
                  Add Wake Word
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
