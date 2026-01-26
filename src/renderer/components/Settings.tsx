/**
 * Atlas Desktop - Settings Panel Component
 * UI for configuring Atlas settings
 *
 * Session 039-A: Added focus management for keyboard navigation
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  useNovaStore,
  type NovaSettings,
  type QualityPreset,
  QUALITY_PRESETS,
  type PersonalityPreset,
  type AttractorType,
  type OrbColorTheme,
} from '../stores';
import { useModalFocus } from '../hooks';
import { useAccessibility } from './accessibility';
import { LoadingIndicator } from './common';
import { ShortcutSettings } from './ShortcutSettings';
import { SETTINGS_VALIDATION } from '../utils/validation-constants';
import './Settings.css';

/**
 * Budget stats from cost tracker
 */
interface BudgetStats {
  todaySpend: number;
  remainingBudget: number;
  usagePercent: number;
  dailyBudget: number;
  byService: Record<string, { units: number; cost: number }>;
}

interface SettingsSectionProps {
  title: string;
  children: React.ReactNode;
}

const SettingsSection: React.FC<SettingsSectionProps> = ({ title, children }) => (
  <div className="settings-section">
    <h3 className="settings-section-title">{title}</h3>
    <div className="settings-section-content">{children}</div>
  </div>
);

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
}

const Slider: React.FC<SliderProps> = ({
  label,
  value,
  min,
  max,
  step = 0.1,
  onChange,
  formatValue = (v) => v.toFixed(1),
}) => (
  <div className="settings-slider">
    <label className="settings-label">
      {label}
      <span className="settings-value">{formatValue(value)}</span>
    </label>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="settings-range"
    />
  </div>
);

interface SelectProps {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

const Select: React.FC<SelectProps> = ({ label, value, options, onChange }) => (
  <div className="settings-select">
    <label className="settings-label">{label}</label>
    <select value={value} onChange={(e) => onChange(e.target.value)} className="settings-dropdown">
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  </div>
);

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const Toggle: React.FC<ToggleProps> = ({ label, checked, onChange }) => (
  <div className="settings-toggle">
    <label className="settings-label">{label}</label>
    <button
      type="button"
      className={`toggle-switch ${checked ? 'active' : ''}`}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      <span className="toggle-slider" />
    </button>
  </div>
);

interface TextInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  description?: string;
}

const TextInput: React.FC<TextInputProps> = ({
  label,
  value,
  onChange,
  placeholder,
  description,
}) => (
  <div className="settings-text-input">
    <label className="settings-label">{label}</label>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="settings-input"
    />
    {description && <span className="settings-description">{description}</span>}
  </div>
);

/**
 * Settings Panel Component
 */
/**
 * Audio device type from main process (PvRecorder)
 */
interface AudioDeviceInfo {
  index: number;
  name: string;
  isDefault: boolean;
}

export const Settings: React.FC = () => {
  const { settings, updateSettings, isSettingsOpen, toggleSettings } = useNovaStore();
  const [inputDevices, setInputDevices] = useState<AudioDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [budgetStats, setBudgetStats] = useState<BudgetStats | null>(null);
  const [budgetLoading, setBudgetLoading] = useState(false);

  // Focus trap for keyboard navigation (Session 039-A)
  const panelRef = useModalFocus<HTMLDivElement>(isSettingsOpen);

  // Accessibility settings (Session 039-C)
  const { preferences: a11yPrefs, updatePreferences: updateA11yPrefs } = useAccessibility();

  // Mic test state (040-B)
  const [isMicTesting, setIsMicTesting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [deviceError, setDeviceError] = useState<string | null>(null);

  // Fetch available audio devices from main process (PvRecorder)
  useEffect(() => {
    const fetchDevices = async () => {
      try {
        // Get input devices from main process (PvRecorder compatible)
        const mainDevices = await window.atlas?.voice.getAudioDevices();
        if (mainDevices) {
          setInputDevices(mainDevices);
        }

        // Get output devices from browser (for audio playback)
        const browserDevices = await navigator.mediaDevices.enumerateDevices();
        setOutputDevices(browserDevices.filter((d) => d.kind === 'audiooutput'));
      } catch (e) {
        console.warn('[Settings] Failed to enumerate devices:', e);
      }
    };

    if (isSettingsOpen) {
      fetchDevices();
      // Start device monitoring
      window.atlas?.voice.startDeviceMonitoring();
    }

    return () => {
      // Stop monitoring when settings close
      if (isSettingsOpen) {
        window.atlas?.voice.stopDeviceMonitoring();
      }
    };
  }, [isSettingsOpen]);

  // Listen for device changes from main process
  useEffect(() => {
    const unsubscribe = window.atlas?.on('atlas:audio-devices-changed', (event: unknown) => {
      const deviceEvent = event as { devices: AudioDeviceInfo[] };
      if (deviceEvent.devices) {
        setInputDevices(deviceEvent.devices);
      }
    });

    return () => unsubscribe?.();
  }, []);

  // Fetch budget stats when settings open
  useEffect(() => {
    const fetchBudgetStats = async () => {
      if (!isSettingsOpen) return;
      setBudgetLoading(true);
      try {
        const result = await window.atlas?.atlas.getBudgetStats();
        if (result?.success && result.data) {
          setBudgetStats(result.data as BudgetStats);
        }
      } catch (e) {
        console.warn('[Settings] Failed to fetch budget stats:', e);
      } finally {
        setBudgetLoading(false);
      }
    };

    fetchBudgetStats();
  }, [isSettingsOpen]);

  // Update handlers
  const handleUpdate = useCallback(
    <K extends keyof NovaSettings>(key: K, value: NovaSettings[K]) => {
      updateSettings({ [key]: value });
    },
    [updateSettings]
  );

  // Handle budget update
  const handleBudgetUpdate = useCallback(
    async (budget: number) => {
      handleUpdate('dailyBudget', budget);
      try {
        await window.atlas?.atlas.setDailyBudget(budget);
        // Refresh stats
        const result = await window.atlas?.atlas.getBudgetStats();
        if (result?.success && result.data) {
          setBudgetStats(result.data as BudgetStats);
        }
      } catch (e) {
        console.warn('[Settings] Failed to update budget:', e);
      }
    },
    [handleUpdate]
  );

  // Handle close with escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSettingsOpen) {
        toggleSettings();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSettingsOpen, toggleSettings]);

  if (!isSettingsOpen) return null;

  // Handle input device change (sends to main process)
  const handleInputDeviceChange = async (deviceIndex: number) => {
    handleUpdate('inputDevice', deviceIndex === -1 ? null : String(deviceIndex));
    try {
      await window.atlas?.voice.setAudioDevice(deviceIndex);
    } catch (e) {
      console.warn('[Settings] Failed to set audio device:', e);
    }
  };

  // Handle wake word sensitivity change (040-B)
  const handleSensitivityChange = async (sensitivity: number) => {
    handleUpdate('wakeWordSensitivity', sensitivity);
    try {
      await window.atlas?.voice.setSensitivity(sensitivity);
    } catch (e) {
      console.warn('[Settings] Failed to set wake word sensitivity:', e);
    }
  };

  // Handle microphone test (040-B)
  const startMicTest = async () => {
    setIsMicTesting(true);
    setMicLevel(0);
    setDeviceError(null);

    try {
      // Check if getUserMedia is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone access is not supported in this browser');
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let animationId: number;

      const updateLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length;
        setMicLevel(avg / 255);
        animationId = requestAnimationFrame(updateLevel);
      };
      updateLevel();

      // Auto-stop after test duration
      setTimeout(() => {
        cancelAnimationFrame(animationId);
        stream.getTracks().forEach((track) => track.stop());
        audioContext.close();
        setIsMicTesting(false);
      }, SETTINGS_VALIDATION.MIC_TEST_DURATION_MS);
    } catch (e) {
      console.warn('[Settings] Microphone test failed:', e);

      // Set user-friendly error message
      let errorMsg = 'Failed to access microphone';
      if (e instanceof Error) {
        if (e.name === 'NotAllowedError') {
          errorMsg = 'Microphone access denied. Please grant permission and try again.';
        } else if (e.name === 'NotFoundError') {
          errorMsg = 'No microphone found. Please connect a microphone and try again.';
        } else if (e.name === 'NotReadableError') {
          errorMsg = 'Microphone is already in use by another application.';
        } else if (e.message) {
          errorMsg = e.message;
        }
      }

      setDeviceError(errorMsg);
      setIsMicTesting(false);
    }
  };

  return (
    <div className="settings-overlay" onClick={toggleSettings} role="presentation">
      <div
        ref={panelRef}
        className="settings-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="settings-header">
          <h2 id="settings-title">Settings</h2>
          <button className="settings-close" onClick={toggleSettings} aria-label="Close settings">
            ×
          </button>
        </div>

        <div className="settings-content">
          {/* Audio Settings */}
          <SettingsSection title="Audio">
            <Select
              label="Input Device (Microphone)"
              value={settings.inputDevice || '-1'}
              options={inputDevices.map((d) => ({
                value: String(d.index),
                label: d.name,
              }))}
              onChange={(v) => handleInputDeviceChange(parseInt(v, 10))}
            />

            {/* Microphone Test (040-B) */}
            <div className="settings-mic-test">
              <div className="mic-test-header">
                <label className="settings-label">Microphone Test</label>
                <button
                  className={`mic-test-button ${isMicTesting ? 'testing' : ''}`}
                  onClick={startMicTest}
                  disabled={isMicTesting}
                >
                  {isMicTesting ? 'Testing...' : 'Test Mic'}
                </button>
              </div>
              <div className="mic-level-bar">
                <div className="mic-level-fill" style={{ width: `${micLevel * 100}%` }} />
              </div>
              {isMicTesting && <span className="mic-test-hint">Speak into your microphone</span>}
              {deviceError && (
                <div className="device-error" role="alert">
                  {deviceError}
                </div>
              )}
            </div>

            <Select
              label="Output Device (Speaker)"
              value={settings.outputDevice || 'default'}
              options={[
                { value: 'default', label: 'System Default' },
                ...outputDevices.map((d) => ({
                  value: d.deviceId,
                  label: d.label || `Speaker ${d.deviceId.slice(0, 8)}`,
                })),
              ]}
              onChange={(v) => handleUpdate('outputDevice', v === 'default' ? null : v)}
            />

            <Slider
              label="Volume"
              value={settings.audioVolume}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => handleUpdate('audioVolume', v)}
              formatValue={(v) => `${Math.round(v * 100)}%`}
            />

            <Slider
              label="Wake Word Sensitivity"
              value={settings.wakeWordSensitivity}
              min={0}
              max={1}
              step={0.05}
              onChange={handleSensitivityChange}
              formatValue={(v) => `${Math.round(v * 100)}%`}
            />

            {/* Audio Feedback Toggle */}
            <div className="settings-toggle">
              <label className="settings-label">
                Audio Feedback
                <span className="settings-description">
                  Play sound cues when listening, thinking, or speaking
                </span>
              </label>
              <button
                className={`toggle-button ${settings.audioFeedbackEnabled ? 'active' : ''}`}
                onClick={() => handleUpdate('audioFeedbackEnabled', !settings.audioFeedbackEnabled)}
                aria-pressed={settings.audioFeedbackEnabled}
              >
                {settings.audioFeedbackEnabled ? 'On' : 'Off'}
              </button>
            </div>

            {settings.audioFeedbackEnabled && (
              <Slider
                label="Feedback Volume"
                value={settings.audioFeedbackVolume ?? 0.3}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => handleUpdate('audioFeedbackVolume', v)}
                formatValue={(v) => `${Math.round(v * 100)}%`}
              />
            )}
          </SettingsSection>

          {/* Voice Settings */}
          <SettingsSection title="Voice">
            <Slider
              label="Speech Speed"
              value={settings.voiceSpeed}
              min={0.5}
              max={2.0}
              step={0.1}
              onChange={(v) => handleUpdate('voiceSpeed', v)}
              formatValue={(v) => `${v.toFixed(1)}x`}
            />

            <Slider
              label="Voice Stability"
              value={settings.voiceStability}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => handleUpdate('voiceStability', v)}
              formatValue={(v) => `${Math.round(v * 100)}%`}
            />
          </SettingsSection>

          {/* Visual Settings */}
          <SettingsSection title="Visual">
            <Select
              label="Quality Preset"
              value={settings.qualityPreset}
              options={[
                { value: 'low', label: 'Low (3K particles)' },
                { value: 'medium', label: 'Medium (8K particles)' },
                { value: 'high', label: 'High (15K particles)' },
                { value: 'ultra', label: 'Ultra (35K particles)' },
                { value: 'custom', label: 'Custom' },
              ]}
              onChange={(v) => {
                const preset = v as QualityPreset;
                if (preset !== 'custom') {
                  const config = QUALITY_PRESETS[preset];
                  updateSettings({
                    qualityPreset: preset,
                    particleCount: config.particles,
                    enableEffects: config.effects,
                    enableShadows: config.shadows,
                    enablePostProcessing: config.postProcessing,
                    enableAntialiasing: config.antialiasing,
                  });
                } else {
                  handleUpdate('qualityPreset', preset);
                }
              }}
            />

            <Toggle
              label="Adaptive Performance"
              checked={settings.adaptivePerformance}
              onChange={(v) => handleUpdate('adaptivePerformance', v)}
            />

            {settings.qualityPreset === 'custom' && (
              <>
                <Slider
                  label="Particle Count"
                  value={settings.particleCount}
                  min={1000}
                  max={50000}
                  step={1000}
                  onChange={(v) => handleUpdate('particleCount', v)}
                  formatValue={(v) => `${(v / 1000).toFixed(0)}K`}
                />

                <Toggle
                  label="Visual Effects"
                  checked={settings.enableEffects}
                  onChange={(v) => handleUpdate('enableEffects', v)}
                />

                <Toggle
                  label="Shadows"
                  checked={settings.enableShadows}
                  onChange={(v) => handleUpdate('enableShadows', v)}
                />

                <Toggle
                  label="Post Processing"
                  checked={settings.enablePostProcessing}
                  onChange={(v) => handleUpdate('enablePostProcessing', v)}
                />

                <Toggle
                  label="Antialiasing"
                  checked={settings.enableAntialiasing}
                  onChange={(v) => handleUpdate('enableAntialiasing', v)}
                />
              </>
            )}

            <Select
              label="Theme"
              value={settings.theme}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
                { value: 'system', label: 'System' },
              ]}
              onChange={(v) => handleUpdate('theme', v as 'dark' | 'light' | 'system')}
            />

            <Toggle
              label="Show Transcript"
              checked={settings.showTranscript}
              onChange={(v) => handleUpdate('showTranscript', v)}
            />

            <Toggle
              label="Show Debug Overlay"
              checked={settings.showDebug}
              onChange={(v) => handleUpdate('showDebug', v)}
            />
          </SettingsSection>

          {/* Accessibility Settings (039-C) */}
          <SettingsSection title="Accessibility">
            <Toggle
              label="Use System Preferences"
              checked={a11yPrefs.useSystemPreferences}
              onChange={(v) => updateA11yPrefs({ useSystemPreferences: v })}
            />
            <span className="settings-description">
              Automatically detect OS high contrast and reduced motion settings
            </span>

            <Toggle
              label="High Contrast Mode"
              checked={a11yPrefs.highContrastMode}
              onChange={(v) => updateA11yPrefs({ highContrastMode: v })}
            />
            <span className="settings-description">
              Increase color contrast for better visibility
            </span>

            <Toggle
              label="Reduced Motion"
              checked={a11yPrefs.reducedMotion}
              onChange={(v) => updateA11yPrefs({ reducedMotion: v })}
            />
            <span className="settings-description">Minimize animations and particle effects</span>

            <Toggle
              label="Enhanced Focus Indicators"
              checked={a11yPrefs.enhancedFocusIndicators}
              onChange={(v) => updateA11yPrefs({ enhancedFocusIndicators: v })}
            />
            <span className="settings-description">
              Show larger, more visible focus rings for keyboard navigation
            </span>

            <Toggle
              label="Screen Reader Support"
              checked={a11yPrefs.screenReaderEnabled}
              onChange={(v) => updateA11yPrefs({ screenReaderEnabled: v })}
            />
            <span className="settings-description">
              Enable ARIA live region announcements for assistive technology
            </span>

            <Slider
              label="Font Scale"
              value={a11yPrefs.fontScale}
              min={0.75}
              max={2.0}
              step={0.05}
              onChange={(v) => updateA11yPrefs({ fontScale: v })}
              formatValue={(v) => `${Math.round(v * 100)}%`}
            />
            <span className="settings-description">
              Adjust text size throughout the application
            </span>
          </SettingsSection>

          {/* Orb Visualization Settings (040-A) */}
          <SettingsSection title="Orb Visualization">
            <Select
              label="Attractor Type"
              value={settings.attractorType}
              options={[
                { value: 'auto', label: 'Auto (State-Based)' },
                { value: 'aizawa', label: 'Aizawa (Ribbon)' },
                { value: 'lorenz', label: 'Lorenz (Butterfly)' },
                { value: 'thomas', label: 'Thomas (Spiral)' },
                { value: 'halvorsen', label: 'Halvorsen (Complex)' },
                { value: 'arneodo', label: 'Arneodo (Chaotic)' },
              ]}
              onChange={(v) => handleUpdate('attractorType', v as AttractorType)}
            />

            <Select
              label="Color Theme"
              value={settings.orbColorTheme}
              options={[
                { value: 'auto', label: 'Auto (State-Based)' },
                { value: 'cyan', label: 'Cyan (Default)' },
                { value: 'blue', label: 'Blue' },
                { value: 'purple', label: 'Purple' },
                { value: 'gold', label: 'Gold' },
                { value: 'green', label: 'Green' },
                { value: 'pink', label: 'Pink' },
                { value: 'custom', label: 'Custom' },
              ]}
              onChange={(v) => handleUpdate('orbColorTheme', v as OrbColorTheme)}
            />

            {settings.orbColorTheme === 'custom' && (
              <Slider
                label="Custom Hue"
                value={settings.customOrbHue}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => handleUpdate('customOrbHue', v)}
                formatValue={(v) => `${Math.round(v * 360)}°`}
              />
            )}

            <Slider
              label="Brightness"
              value={settings.orbBrightness}
              min={0.3}
              max={1.5}
              step={0.05}
              onChange={(v) => handleUpdate('orbBrightness', v)}
              formatValue={(v) => `${Math.round(v * 100)}%`}
            />

            <Slider
              label="Saturation"
              value={settings.orbSaturation}
              min={0}
              max={1.5}
              step={0.05}
              onChange={(v) => handleUpdate('orbSaturation', v)}
              formatValue={(v) => `${Math.round(v * 100)}%`}
            />
          </SettingsSection>

          {/* Behavior Settings */}
          <SettingsSection title="Behavior">
            <TextInput
              label="Wake Word"
              value={settings.wakeWord}
              onChange={(v) => handleUpdate('wakeWord', v)}
              placeholder="Hey Atlas"
              description="The phrase Atlas listens for to activate"
            />

            <Toggle
              label="Auto Start"
              checked={settings.autoStart}
              onChange={(v) => handleUpdate('autoStart', v)}
            />

            <Toggle
              label="Push to Talk"
              checked={settings.pushToTalk}
              onChange={(v) => handleUpdate('pushToTalk', v)}
            />

            <Toggle
              label="Minimize to Tray"
              checked={settings.minimizeToTray}
              onChange={(v) => handleUpdate('minimizeToTray', v)}
            />

            <Toggle
              label="Start Minimized"
              checked={settings.startMinimized}
              onChange={(v) => handleUpdate('startMinimized', v)}
            />
          </SettingsSection>

          {/* Keyboard Shortcuts (047-B) */}
          <SettingsSection title="Keyboard Shortcuts">
            <ShortcutSettings />
          </SettingsSection>

          {/* Privacy Settings (040-C) */}
          <SettingsSection title="Privacy">
            <Toggle
              label="Privacy Mode"
              checked={settings.enablePrivacyMode}
              onChange={(v) => handleUpdate('enablePrivacyMode', v)}
            />
            <span className="settings-description">
              When enabled, conversations are not logged to disk
            </span>

            <div className="settings-actions">
              <button
                className="settings-action-button danger"
                onClick={async () => {
                  if (window.confirm('This will delete all conversation history. Are you sure?')) {
                    await window.atlas?.atlas.clearMemory();
                  }
                }}
              >
                Clear Conversation History
              </button>
            </div>
          </SettingsSection>

          {/* Provider Settings */}
          <SettingsSection title="AI Providers">
            <Select
              label="Speech Recognition"
              value={settings.preferredSttProvider}
              options={[
                { value: 'auto', label: 'Auto (Deepgram → Vosk)' },
                { value: 'deepgram', label: 'Deepgram (Online)' },
                { value: 'vosk', label: 'Vosk (Offline)' },
              ]}
              onChange={(v) =>
                handleUpdate('preferredSttProvider', v as 'deepgram' | 'vosk' | 'auto')
              }
            />

            <Select
              label="Language Model"
              value={settings.preferredLlmProvider}
              options={[
                { value: 'auto', label: 'Auto (Fireworks → OpenRouter)' },
                { value: 'fireworks', label: 'Fireworks' },
                { value: 'openrouter', label: 'OpenRouter' },
              ]}
              onChange={(v) =>
                handleUpdate('preferredLlmProvider', v as 'fireworks' | 'openrouter' | 'auto')
              }
            />

            <Slider
              label="Conversation History"
              value={settings.maxConversationHistory}
              min={10}
              max={100}
              step={5}
              onChange={(v) => handleUpdate('maxConversationHistory', v)}
              formatValue={(v) => `${v} messages`}
            />
          </SettingsSection>

          {/* Personality Settings */}
          <SettingsSection title="Personality">
            <Select
              label="Personality Preset"
              value={settings.personalityPreset}
              options={[
                { value: 'atlas', label: 'Atlas (Default)' },
                { value: 'professional', label: 'Professional' },
                { value: 'playful', label: 'Playful' },
                { value: 'minimal', label: 'Minimal' },
                { value: 'custom', label: 'Custom' },
              ]}
              onChange={(v) => {
                const preset = v as PersonalityPreset;
                handleUpdate('personalityPreset', preset);
                // Also update main process
                window.atlas?.atlas.setPersonalityPreset(preset);
              }}
            />

            {settings.personalityPreset === 'custom' && (
              <>
                <Slider
                  label="Friendliness"
                  value={settings.personalityTraits.friendliness}
                  min={0}
                  max={1}
                  step={0.1}
                  onChange={(v) => {
                    handleUpdate('personalityTraits', {
                      ...settings.personalityTraits,
                      friendliness: v,
                    });
                    window.atlas?.atlas.setPersonalityTrait('friendliness', v);
                  }}
                  formatValue={(v) => (v >= 0.7 ? 'Warm' : v >= 0.4 ? 'Neutral' : 'Reserved')}
                />

                <Slider
                  label="Formality"
                  value={settings.personalityTraits.formality}
                  min={0}
                  max={1}
                  step={0.1}
                  onChange={(v) => {
                    handleUpdate('personalityTraits', {
                      ...settings.personalityTraits,
                      formality: v,
                    });
                    window.atlas?.atlas.setPersonalityTrait('formality', v);
                  }}
                  formatValue={(v) => (v >= 0.7 ? 'Formal' : v >= 0.4 ? 'Balanced' : 'Casual')}
                />

                <Slider
                  label="Humor"
                  value={settings.personalityTraits.humor}
                  min={0}
                  max={1}
                  step={0.1}
                  onChange={(v) => {
                    handleUpdate('personalityTraits', {
                      ...settings.personalityTraits,
                      humor: v,
                    });
                    window.atlas?.atlas.setPersonalityTrait('humor', v);
                  }}
                  formatValue={(v) => (v >= 0.7 ? 'Playful' : v >= 0.4 ? 'Light' : 'Serious')}
                />

                <Slider
                  label="Curiosity"
                  value={settings.personalityTraits.curiosity}
                  min={0}
                  max={1}
                  step={0.1}
                  onChange={(v) => {
                    handleUpdate('personalityTraits', {
                      ...settings.personalityTraits,
                      curiosity: v,
                    });
                    window.atlas?.atlas.setPersonalityTrait('curiosity', v);
                  }}
                  formatValue={(v) => (v >= 0.7 ? 'Inquisitive' : v >= 0.4 ? 'Moderate' : 'Direct')}
                />

                <Slider
                  label="Energy"
                  value={settings.personalityTraits.energy}
                  min={0}
                  max={1}
                  step={0.1}
                  onChange={(v) => {
                    handleUpdate('personalityTraits', {
                      ...settings.personalityTraits,
                      energy: v,
                    });
                    window.atlas?.atlas.setPersonalityTrait('energy', v);
                  }}
                  formatValue={(v) => (v >= 0.7 ? 'Enthusiastic' : v >= 0.4 ? 'Balanced' : 'Calm')}
                />

                <Slider
                  label="Patience"
                  value={settings.personalityTraits.patience}
                  min={0}
                  max={1}
                  step={0.1}
                  onChange={(v) => {
                    handleUpdate('personalityTraits', {
                      ...settings.personalityTraits,
                      patience: v,
                    });
                    window.atlas?.atlas.setPersonalityTrait('patience', v);
                  }}
                  formatValue={(v) => (v >= 0.7 ? 'Thorough' : v >= 0.4 ? 'Moderate' : 'Brief')}
                />
              </>
            )}
          </SettingsSection>

          {/* Budget & Usage Settings */}
          <SettingsSection title="Budget & Usage">
            <Slider
              label="Daily Budget"
              value={settings.dailyBudget}
              min={0.5}
              max={20}
              step={0.5}
              onChange={(v) => handleBudgetUpdate(v)}
              formatValue={(v) => `$${v.toFixed(2)}`}
            />

            {/* Budget Progress Bar */}
            <div className="budget-usage">
              <label className="settings-label">Today&apos;s Usage</label>
              <div className="budget-bar-container">
                <div
                  className={`budget-bar ${
                    budgetStats && budgetStats.usagePercent >= 1
                      ? 'exceeded'
                      : budgetStats && budgetStats.usagePercent >= 0.8
                        ? 'warning'
                        : ''
                  }`}
                  style={{
                    width: `${Math.min(100, (budgetStats?.usagePercent ?? 0) * 100)}%`,
                  }}
                />
              </div>
              <div className="budget-stats">
                {budgetLoading ? (
                  <LoadingIndicator size="small" variant="dots" inline text="Loading..." />
                ) : budgetStats ? (
                  <>
                    <span className="budget-spent">${budgetStats.todaySpend.toFixed(3)} spent</span>
                    <span className="budget-remaining">
                      ${budgetStats.remainingBudget.toFixed(2)} remaining
                    </span>
                  </>
                ) : (
                  <span className="budget-na">No usage data</span>
                )}
              </div>
            </div>

            {/* Service breakdown */}
            {budgetStats && budgetStats.byService && (
              <div className="service-usage">
                <label className="settings-label">Usage by Service</label>
                <div className="service-list">
                  {Object.entries(budgetStats.byService)
                    .filter(([, data]) => data.cost > 0)
                    .map(([service, data]) => (
                      <div key={service} className="service-item">
                        <span className="service-name">{service}</span>
                        <span className="service-cost">${data.cost.toFixed(4)}</span>
                      </div>
                    ))}
                  {Object.values(budgetStats.byService).every((d) => d.cost === 0) && (
                    <div className="service-item no-usage">No API usage today</div>
                  )}
                </div>
              </div>
            )}

            <Slider
              label="Warning Threshold"
              value={settings.budgetWarningThreshold}
              min={0.5}
              max={0.95}
              step={0.05}
              onChange={(v) => handleUpdate('budgetWarningThreshold', v)}
              formatValue={(v) => `${Math.round(v * 100)}%`}
            />
          </SettingsSection>
        </div>

        <div className="settings-footer">
          <button
            className="settings-button settings-button-secondary"
            onClick={() => {
              if (confirm('Reset all settings to defaults?')) {
                updateSettings({
                  inputDevice: null,
                  outputDevice: null,
                  audioVolume: 1.0,
                  voiceId: 'atlas',
                  voiceSpeed: 1.0,
                  voiceStability: 0.5,
                  particleCount: 35000,
                  showTranscript: true,
                  theme: 'dark',
                  adaptivePerformance: true,
                  qualityPreset: 'ultra',
                  enableEffects: true,
                  enableShadows: true,
                  enablePostProcessing: true,
                  enableAntialiasing: true,
                  // Orb visualization defaults (040-A)
                  attractorType: 'auto',
                  orbColorTheme: 'auto',
                  customOrbHue: 0.55,
                  orbBrightness: 1.0,
                  orbSaturation: 1.0,
                  autoStart: true,
                  pushToTalk: false,
                  wakeWord: 'Hey Atlas',
                  preferredLlmProvider: 'auto',
                  preferredSttProvider: 'auto',
                  maxConversationHistory: 50,
                  personalityPreset: 'atlas',
                  personalityTraits: {
                    friendliness: 0.9,
                    formality: 0.3,
                    humor: 0.7,
                    curiosity: 0.9,
                    energy: 0.8,
                    patience: 0.9,
                  },
                  showDebug: false,
                });
                // Reset personality in main process too
                window.atlas?.atlas.setPersonalityPreset('atlas');
              }
            }}
          >
            Reset to Defaults
          </button>

          <button className="settings-button settings-button-primary" onClick={toggleSettings}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
