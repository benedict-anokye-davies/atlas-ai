/**
 * Atlas Desktop - Voice Feedback Settings
 * Configure how Atlas provides audio/voice feedback
 */

import { useState, useEffect, useCallback } from 'react';
import './VoiceFeedbackSettings.css';

interface VoiceFeedbackSettingsProps {
  isVisible: boolean;
  onClose: () => void;
}

interface VoiceSettings {
  // TTS Settings
  ttsEnabled: boolean;
  ttsVoice: string;
  ttsSpeed: number;
  ttsPitch: number;
  ttsVolume: number;
  
  // Sound Effects
  soundEffectsEnabled: boolean;
  wakeWordSound: boolean;
  listeningSound: boolean;
  processingSound: boolean;
  responseSound: boolean;
  errorSound: boolean;
  soundEffectsVolume: number;
  
  // Feedback Modes
  verbosityLevel: 'minimal' | 'normal' | 'verbose';
  readbackCommands: boolean;
  confirmActions: boolean;
  announceState: boolean;
  
  // Interruption Settings
  allowInterruption: boolean;
  interruptionDelay: number;
  fadeOnInterrupt: boolean;
  
  // Accessibility
  screenReaderMode: boolean;
  slowMode: boolean;
}

const DEFAULT_SETTINGS: VoiceSettings = {
  ttsEnabled: true,
  ttsVoice: 'default',
  ttsSpeed: 1.0,
  ttsPitch: 1.0,
  ttsVolume: 0.8,
  soundEffectsEnabled: true,
  wakeWordSound: true,
  listeningSound: true,
  processingSound: false,
  responseSound: true,
  errorSound: true,
  soundEffectsVolume: 0.5,
  verbosityLevel: 'normal',
  readbackCommands: false,
  confirmActions: true,
  announceState: true,
  allowInterruption: true,
  interruptionDelay: 500,
  fadeOnInterrupt: true,
  screenReaderMode: false,
  slowMode: false,
};

const AVAILABLE_VOICES = [
  { id: 'default', name: 'Default System Voice' },
  { id: 'elevenlabs-rachel', name: 'ElevenLabs - Rachel' },
  { id: 'elevenlabs-drew', name: 'ElevenLabs - Drew' },
  { id: 'elevenlabs-clyde', name: 'ElevenLabs - Clyde' },
  { id: 'elevenlabs-paul', name: 'ElevenLabs - Paul' },
  { id: 'elevenlabs-domi', name: 'ElevenLabs - Domi' },
  { id: 'elevenlabs-bella', name: 'ElevenLabs - Bella' },
  { id: 'elevenlabs-antoni', name: 'ElevenLabs - Antoni' },
  { id: 'elevenlabs-thomas', name: 'ElevenLabs - Thomas' },
];

export function VoiceFeedbackSettings({ isVisible, onClose }: VoiceFeedbackSettingsProps) {
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_SETTINGS);
  const [activeSection, setActiveSection] = useState<'voice' | 'sounds' | 'feedback' | 'interruption'>('voice');
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Load settings
  useEffect(() => {
    if (!isVisible) return;
    
    const saved = localStorage.getItem('atlas-voice-feedback-settings');
    if (saved) {
      try {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
      } catch (e) {
        console.error('Failed to load voice settings:', e);
      }
    }
  }, [isVisible]);

  // Save settings
  const saveSettings = useCallback(() => {
    localStorage.setItem('atlas-voice-feedback-settings', JSON.stringify(settings));
    
    // Apply settings via IPC if available - updateSettings not in current VoiceAPI
    const voiceAny = window.atlas?.voice as unknown as Record<string, unknown> | undefined;
    if (voiceAny?.updateSettings && typeof voiceAny.updateSettings === 'function') {
      (voiceAny.updateSettings as (settings: VoiceSettings) => void)(settings);
    }
    
    setHasChanges(false);
  }, [settings]);

  // Update a setting
  const updateSetting = useCallback(<K extends keyof VoiceSettings>(
    key: K,
    value: VoiceSettings[K]
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  }, []);

  // Test voice
  const testVoice = useCallback(async () => {
    setIsPlaying(true);
    try {
      const testText = "Hello! I'm Atlas, your voice assistant. This is how I'll sound.";
      
      // tts API not exposed directly on window.atlas - use dynamic check
      const atlasAny = window.atlas as unknown as Record<string, unknown> | undefined;
      if (atlasAny?.tts && typeof atlasAny.tts === 'object') {
        const ttsApi = atlasAny.tts as { speak?: (text: string, options: { voice: string; speed: number; pitch: number; volume: number }) => Promise<void> };
        if (ttsApi.speak) {
          await ttsApi.speak(testText, {
            voice: settings.ttsVoice,
            speed: settings.ttsSpeed,
            pitch: settings.ttsPitch,
            volume: settings.ttsVolume,
          });
          setIsPlaying(false);
          return;
        }
      }
      
      // Fallback to Web Speech API
      const utterance = new SpeechSynthesisUtterance(testText);
      utterance.rate = settings.ttsSpeed;
      utterance.pitch = settings.ttsPitch;
      utterance.volume = settings.ttsVolume;
      utterance.onend = () => setIsPlaying(false);
      speechSynthesis.speak(utterance);
    } catch (error) {
      console.error('Voice test failed:', error);
    }
    setIsPlaying(false);
  }, [settings]);

  // Test sound effect
  const testSound = useCallback((soundType: string) => {
    // Placeholder - would trigger actual sound
    console.log('Testing sound:', soundType);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  return (
    <div className="voice-settings-overlay" onClick={onClose}>
      <div className="voice-settings-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="vfs-header">
          <div className="vfs-title-row">
            <svg className="vfs-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            <h2>Voice Feedback Settings</h2>
          </div>
          <button className="vfs-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Sections Nav */}
        <div className="vfs-sections">
          {(['voice', 'sounds', 'feedback', 'interruption'] as const).map((section) => (
            <button
              key={section}
              className={`vfs-section-btn ${activeSection === section ? 'active' : ''}`}
              onClick={() => setActiveSection(section)}
            >
              {section === 'voice' && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                </svg>
              )}
              {section === 'sounds' && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 5L6 9H2v6h4l5 4V5z" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
              )}
              {section === 'feedback' && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              )}
              {section === 'interruption' && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              )}
              <span>{section.charAt(0).toUpperCase() + section.slice(1)}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="vfs-content">
          {activeSection === 'voice' && (
            <div className="settings-section">
              <div className="setting-group">
                <div className="setting-row toggle-row">
                  <div className="setting-info">
                    <div className="setting-label">Enable Voice Responses</div>
                    <div className="setting-desc">Atlas will speak responses aloud</div>
                  </div>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={settings.ttsEnabled}
                      onChange={(e) => updateSetting('ttsEnabled', e.target.checked)}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
              </div>

              <div className="setting-group">
                <div className="setting-label">Voice Selection</div>
                <select
                  className="setting-select"
                  value={settings.ttsVoice}
                  onChange={(e) => updateSetting('ttsVoice', e.target.value)}
                  disabled={!settings.ttsEnabled}
                >
                  {AVAILABLE_VOICES.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="setting-group">
                <div className="setting-label">Speed: {settings.ttsSpeed.toFixed(1)}x</div>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={settings.ttsSpeed}
                  onChange={(e) => updateSetting('ttsSpeed', parseFloat(e.target.value))}
                  disabled={!settings.ttsEnabled}
                  className="setting-slider"
                />
                <div className="slider-labels">
                  <span>Slow</span>
                  <span>Fast</span>
                </div>
              </div>

              <div className="setting-group">
                <div className="setting-label">Pitch: {settings.ttsPitch.toFixed(1)}</div>
                <input
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.1"
                  value={settings.ttsPitch}
                  onChange={(e) => updateSetting('ttsPitch', parseFloat(e.target.value))}
                  disabled={!settings.ttsEnabled}
                  className="setting-slider"
                />
                <div className="slider-labels">
                  <span>Low</span>
                  <span>High</span>
                </div>
              </div>

              <div className="setting-group">
                <div className="setting-label">Volume: {Math.round(settings.ttsVolume * 100)}%</div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.ttsVolume}
                  onChange={(e) => updateSetting('ttsVolume', parseFloat(e.target.value))}
                  disabled={!settings.ttsEnabled}
                  className="setting-slider"
                />
              </div>

              <button 
                className="test-btn"
                onClick={testVoice}
                disabled={!settings.ttsEnabled || isPlaying}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                {isPlaying ? 'Playing...' : 'Test Voice'}
              </button>
            </div>
          )}

          {activeSection === 'sounds' && (
            <div className="settings-section">
              <div className="setting-group">
                <div className="setting-row toggle-row">
                  <div className="setting-info">
                    <div className="setting-label">Enable Sound Effects</div>
                    <div className="setting-desc">Play audio cues for actions</div>
                  </div>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={settings.soundEffectsEnabled}
                      onChange={(e) => updateSetting('soundEffectsEnabled', e.target.checked)}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
              </div>

              <div className="setting-group">
                <div className="setting-label">Sound Effects Volume: {Math.round(settings.soundEffectsVolume * 100)}%</div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.soundEffectsVolume}
                  onChange={(e) => updateSetting('soundEffectsVolume', parseFloat(e.target.value))}
                  disabled={!settings.soundEffectsEnabled}
                  className="setting-slider"
                />
              </div>

              <div className="sounds-grid">
                <div className="sound-item">
                  <div className="sound-info">
                    <div className="sound-name">Wake Word Detected</div>
                    <div className="sound-desc">When "Hey Atlas" is heard</div>
                  </div>
                  <div className="sound-controls">
                    <button 
                      className="sound-test" 
                      onClick={() => testSound('wake')}
                      disabled={!settings.soundEffectsEnabled}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    </button>
                    <label className="toggle small">
                      <input
                        type="checkbox"
                        checked={settings.wakeWordSound}
                        onChange={(e) => updateSetting('wakeWordSound', e.target.checked)}
                        disabled={!settings.soundEffectsEnabled}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                </div>

                <div className="sound-item">
                  <div className="sound-info">
                    <div className="sound-name">Start Listening</div>
                    <div className="sound-desc">When Atlas begins listening</div>
                  </div>
                  <div className="sound-controls">
                    <button 
                      className="sound-test" 
                      onClick={() => testSound('listening')}
                      disabled={!settings.soundEffectsEnabled}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    </button>
                    <label className="toggle small">
                      <input
                        type="checkbox"
                        checked={settings.listeningSound}
                        onChange={(e) => updateSetting('listeningSound', e.target.checked)}
                        disabled={!settings.soundEffectsEnabled}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                </div>

                <div className="sound-item">
                  <div className="sound-info">
                    <div className="sound-name">Processing</div>
                    <div className="sound-desc">While thinking about response</div>
                  </div>
                  <div className="sound-controls">
                    <button 
                      className="sound-test" 
                      onClick={() => testSound('processing')}
                      disabled={!settings.soundEffectsEnabled}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    </button>
                    <label className="toggle small">
                      <input
                        type="checkbox"
                        checked={settings.processingSound}
                        onChange={(e) => updateSetting('processingSound', e.target.checked)}
                        disabled={!settings.soundEffectsEnabled}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                </div>

                <div className="sound-item">
                  <div className="sound-info">
                    <div className="sound-name">Response Ready</div>
                    <div className="sound-desc">When response is complete</div>
                  </div>
                  <div className="sound-controls">
                    <button 
                      className="sound-test" 
                      onClick={() => testSound('response')}
                      disabled={!settings.soundEffectsEnabled}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    </button>
                    <label className="toggle small">
                      <input
                        type="checkbox"
                        checked={settings.responseSound}
                        onChange={(e) => updateSetting('responseSound', e.target.checked)}
                        disabled={!settings.soundEffectsEnabled}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                </div>

                <div className="sound-item">
                  <div className="sound-info">
                    <div className="sound-name">Error</div>
                    <div className="sound-desc">When something goes wrong</div>
                  </div>
                  <div className="sound-controls">
                    <button 
                      className="sound-test" 
                      onClick={() => testSound('error')}
                      disabled={!settings.soundEffectsEnabled}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    </button>
                    <label className="toggle small">
                      <input
                        type="checkbox"
                        checked={settings.errorSound}
                        onChange={(e) => updateSetting('errorSound', e.target.checked)}
                        disabled={!settings.soundEffectsEnabled}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'feedback' && (
            <div className="settings-section">
              <div className="setting-group">
                <div className="setting-label">Verbosity Level</div>
                <div className="verbosity-options">
                  {(['minimal', 'normal', 'verbose'] as const).map((level) => (
                    <button
                      key={level}
                      className={`verbosity-btn ${settings.verbosityLevel === level ? 'active' : ''}`}
                      onClick={() => updateSetting('verbosityLevel', level)}
                    >
                      <span className="verbosity-name">{level.charAt(0).toUpperCase() + level.slice(1)}</span>
                      <span className="verbosity-desc">
                        {level === 'minimal' && 'Short, essential responses'}
                        {level === 'normal' && 'Balanced responses'}
                        {level === 'verbose' && 'Detailed explanations'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="setting-group">
                <div className="setting-row toggle-row">
                  <div className="setting-info">
                    <div className="setting-label">Read Back Commands</div>
                    <div className="setting-desc">Repeat what you said before responding</div>
                  </div>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={settings.readbackCommands}
                      onChange={(e) => updateSetting('readbackCommands', e.target.checked)}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
              </div>

              <div className="setting-group">
                <div className="setting-row toggle-row">
                  <div className="setting-info">
                    <div className="setting-label">Confirm Actions</div>
                    <div className="setting-desc">Ask for confirmation before executing</div>
                  </div>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={settings.confirmActions}
                      onChange={(e) => updateSetting('confirmActions', e.target.checked)}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
              </div>

              <div className="setting-group">
                <div className="setting-row toggle-row">
                  <div className="setting-info">
                    <div className="setting-label">Announce State Changes</div>
                    <div className="setting-desc">Say when listening, thinking, etc.</div>
                  </div>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={settings.announceState}
                      onChange={(e) => updateSetting('announceState', e.target.checked)}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
              </div>

              <div className="accessibility-section">
                <h3>Accessibility</h3>
                
                <div className="setting-group">
                  <div className="setting-row toggle-row">
                    <div className="setting-info">
                      <div className="setting-label">Screen Reader Mode</div>
                      <div className="setting-desc">Optimize for screen readers</div>
                    </div>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={settings.screenReaderMode}
                        onChange={(e) => updateSetting('screenReaderMode', e.target.checked)}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                </div>

                <div className="setting-group">
                  <div className="setting-row toggle-row">
                    <div className="setting-info">
                      <div className="setting-label">Slow Mode</div>
                      <div className="setting-desc">Slower speech with pauses</div>
                    </div>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={settings.slowMode}
                        onChange={(e) => updateSetting('slowMode', e.target.checked)}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'interruption' && (
            <div className="settings-section">
              <div className="setting-group">
                <div className="setting-row toggle-row">
                  <div className="setting-info">
                    <div className="setting-label">Allow Interruption (Barge-in)</div>
                    <div className="setting-desc">Stop Atlas mid-sentence by speaking</div>
                  </div>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={settings.allowInterruption}
                      onChange={(e) => updateSetting('allowInterruption', e.target.checked)}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
              </div>

              <div className="setting-group">
                <div className="setting-label">Interruption Delay: {settings.interruptionDelay}ms</div>
                <div className="setting-desc">How long to wait before interrupting</div>
                <input
                  type="range"
                  min="0"
                  max="2000"
                  step="100"
                  value={settings.interruptionDelay}
                  onChange={(e) => updateSetting('interruptionDelay', parseInt(e.target.value))}
                  disabled={!settings.allowInterruption}
                  className="setting-slider"
                />
                <div className="slider-labels">
                  <span>Instant</span>
                  <span>2 sec</span>
                </div>
              </div>

              <div className="setting-group">
                <div className="setting-row toggle-row">
                  <div className="setting-info">
                    <div className="setting-label">Fade on Interrupt</div>
                    <div className="setting-desc">Smoothly fade out instead of cutting off</div>
                  </div>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={settings.fadeOnInterrupt}
                      onChange={(e) => updateSetting('fadeOnInterrupt', e.target.checked)}
                      disabled={!settings.allowInterruption}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
              </div>

              <div className="interruption-info">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <p>
                  When interruption is enabled, simply start speaking to stop Atlas. 
                  A shorter delay makes interruption more responsive but may trigger accidentally.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="vfs-footer">
          <button 
            className="reset-btn"
            onClick={() => {
              setSettings(DEFAULT_SETTINGS);
              setHasChanges(true);
            }}
          >
            Reset to Defaults
          </button>
          <div className="footer-actions">
            <button className="cancel-btn" onClick={onClose}>
              Cancel
            </button>
            <button 
              className="save-btn"
              onClick={saveSettings}
              disabled={!hasChanges}
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
