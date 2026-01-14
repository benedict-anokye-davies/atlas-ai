/**
 * Nova Desktop - Settings Panel Component
 * UI for configuring Nova settings
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNovaStore, type NovaSettings, type QualityPreset, QUALITY_PRESETS } from '../stores';
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

/**
 * Settings Panel Component
 */
export const Settings: React.FC = () => {
  const { settings, updateSettings, isSettingsOpen, toggleSettings } = useNovaStore();
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [budgetStats, setBudgetStats] = useState<BudgetStats | null>(null);
  const [budgetLoading, setBudgetLoading] = useState(false);

  // Fetch available audio devices
  useEffect(() => {
    const fetchDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setAudioDevices(devices);
      } catch (e) {
        console.warn('[Settings] Failed to enumerate devices:', e);
      }
    };

    if (isSettingsOpen) {
      fetchDevices();
    }
  }, [isSettingsOpen]);

  // Fetch budget stats when settings open
  useEffect(() => {
    const fetchBudgetStats = async () => {
      if (!isSettingsOpen) return;
      setBudgetLoading(true);
      try {
        const result = await window.nova?.nova.getBudgetStats();
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
        await window.nova?.nova.setDailyBudget(budget);
        // Refresh stats
        const result = await window.nova?.nova.getBudgetStats();
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

  const inputDevices = audioDevices.filter((d) => d.kind === 'audioinput');
  const outputDevices = audioDevices.filter((d) => d.kind === 'audiooutput');

  return (
    <div className="settings-overlay" onClick={toggleSettings}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={toggleSettings} aria-label="Close settings">
            ×
          </button>
        </div>

        <div className="settings-content">
          {/* Audio Settings */}
          <SettingsSection title="Audio">
            <Select
              label="Input Device"
              value={settings.inputDevice || 'default'}
              options={[
                { value: 'default', label: 'System Default' },
                ...inputDevices.map((d) => ({
                  value: d.deviceId,
                  label: d.label || `Microphone ${d.deviceId.slice(0, 8)}`,
                })),
              ]}
              onChange={(v) => handleUpdate('inputDevice', v === 'default' ? null : v)}
            />

            <Select
              label="Output Device"
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

          {/* Behavior Settings */}
          <SettingsSection title="Behavior">
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
              <label className="settings-label">Today's Usage</label>
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
                  <span className="budget-loading">Loading...</span>
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
                  voiceId: 'nova',
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
                  autoStart: true,
                  pushToTalk: false,
                  wakeWord: 'Hey Nova',
                  preferredLlmProvider: 'auto',
                  preferredSttProvider: 'auto',
                  maxConversationHistory: 50,
                  showDebug: false,
                });
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
