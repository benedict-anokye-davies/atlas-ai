/**
 * Atlas Desktop - Ambient Mode Component
 * Screensaver with subtle orb animation when idle
 */

import { useState, useEffect, useCallback } from 'react';
import './AmbientMode.css';

interface AmbientModeProps {
  isVisible: boolean;
  onClose: () => void;
}

interface AmbientSettings {
  enabled: boolean;
  idleTimeout: number;
  showClock: boolean;
  showDate: boolean;
  showWeather: boolean;
  animationSpeed: number;
  colorMode: 'dynamic' | 'monochrome' | 'rainbow';
  brightness: number;
  particleDensity: number;
  interactionMode: 'any' | 'click' | 'move';
}

export function AmbientMode({ isVisible, onClose }: AmbientModeProps) {
  const [settings, setSettings] = useState<AmbientSettings>({
    enabled: false,
    idleTimeout: 5,
    showClock: true,
    showDate: true,
    showWeather: false,
    animationSpeed: 1.0,
    colorMode: 'dynamic',
    brightness: 0.8,
    particleDensity: 0.6,
    interactionMode: 'any',
  });
  const [isPreviewActive, setIsPreviewActive] = useState(false);

  // Load settings
  useEffect(() => {
    try {
      const saved = localStorage.getItem('atlas-ambient-settings');
      if (saved) {
        setSettings(JSON.parse(saved));
      }
    } catch (err) {
      console.error('Failed to load ambient settings:', err);
    }
  }, []);

  // Save settings
  useEffect(() => {
    localStorage.setItem('atlas-ambient-settings', JSON.stringify(settings));
  }, [settings]);

  const handleClose = useCallback(() => {
    setIsPreviewActive(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isVisible) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isPreviewActive) {
          setIsPreviewActive(false);
        } else {
          handleClose();
        }
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isVisible, handleClose, isPreviewActive]);

  const getColorModeLabel = (mode: string) => {
    switch (mode) {
      case 'dynamic': return 'Dynamic (changes with Atlas state)';
      case 'monochrome': return 'Monochrome (single color)';
      case 'rainbow': return 'Rainbow (slow color cycling)';
      default: return mode;
    }
  };

  const getInteractionLabel = (mode: string) => {
    switch (mode) {
      case 'any': return 'Any input (mouse, keyboard, or click)';
      case 'click': return 'Click or keypress only';
      case 'move': return 'Mouse movement only';
      default: return mode;
    }
  };

  if (!isVisible) return null;

  return (
    <div className="ambient-overlay" onClick={handleClose}>
      <div className="ambient-container" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="am-header">
          <div className="am-title-row">
            <svg className="am-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
            <h2>Ambient Mode</h2>
          </div>
          <button className="am-close" onClick={handleClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Enable Toggle */}
        <div className="am-enable-section">
          <div className="am-enable-info">
            <h3>Enable Ambient Mode</h3>
            <p>Display a beautiful screensaver when Atlas is idle</p>
          </div>
          <label className="am-toggle">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={e => setSettings(prev => ({ ...prev, enabled: e.target.checked }))}
            />
            <span className="am-toggle-slider"></span>
          </label>
        </div>

        <div className="am-content">
          {/* Activation */}
          <div className="am-section">
            <h3>Activation</h3>
            <div className="am-option-row">
              <label>Idle timeout</label>
              <div className="am-slider-control">
                <input
                  type="range"
                  min="1"
                  max="30"
                  value={settings.idleTimeout}
                  onChange={e => setSettings(prev => ({ ...prev, idleTimeout: Number(e.target.value) }))}
                />
                <span>{settings.idleTimeout} min</span>
              </div>
            </div>
            <div className="am-option-row">
              <label>Exit on</label>
              <select
                value={settings.interactionMode}
                onChange={e => setSettings(prev => ({ ...prev, interactionMode: e.target.value as AmbientSettings['interactionMode'] }))}
                className="am-select"
              >
                <option value="any">Any input</option>
                <option value="click">Click or keypress</option>
                <option value="move">Mouse movement</option>
              </select>
            </div>
            <p className="am-hint">{getInteractionLabel(settings.interactionMode)}</p>
          </div>

          {/* Display Options */}
          <div className="am-section">
            <h3>Display Options</h3>
            <div className="am-checkboxes">
              <label className="am-checkbox">
                <input
                  type="checkbox"
                  checked={settings.showClock}
                  onChange={e => setSettings(prev => ({ ...prev, showClock: e.target.checked }))}
                />
                <span className="am-checkmark"></span>
                <span>Show clock</span>
              </label>
              <label className="am-checkbox">
                <input
                  type="checkbox"
                  checked={settings.showDate}
                  onChange={e => setSettings(prev => ({ ...prev, showDate: e.target.checked }))}
                />
                <span className="am-checkmark"></span>
                <span>Show date</span>
              </label>
              <label className="am-checkbox">
                <input
                  type="checkbox"
                  checked={settings.showWeather}
                  onChange={e => setSettings(prev => ({ ...prev, showWeather: e.target.checked }))}
                />
                <span className="am-checkmark"></span>
                <span>Show weather</span>
              </label>
            </div>
          </div>

          {/* Animation */}
          <div className="am-section">
            <h3>Animation</h3>
            <div className="am-option-row">
              <label>Color mode</label>
              <select
                value={settings.colorMode}
                onChange={e => setSettings(prev => ({ ...prev, colorMode: e.target.value as AmbientSettings['colorMode'] }))}
                className="am-select"
              >
                <option value="dynamic">Dynamic</option>
                <option value="monochrome">Monochrome</option>
                <option value="rainbow">Rainbow</option>
              </select>
            </div>
            <p className="am-hint">{getColorModeLabel(settings.colorMode)}</p>

            <div className="am-option-row">
              <label>Animation speed</label>
              <div className="am-slider-control">
                <input
                  type="range"
                  min="0.2"
                  max="2"
                  step="0.1"
                  value={settings.animationSpeed}
                  onChange={e => setSettings(prev => ({ ...prev, animationSpeed: Number(e.target.value) }))}
                />
                <span>{settings.animationSpeed.toFixed(1)}x</span>
              </div>
            </div>

            <div className="am-option-row">
              <label>Brightness</label>
              <div className="am-slider-control">
                <input
                  type="range"
                  min="0.2"
                  max="1"
                  step="0.1"
                  value={settings.brightness}
                  onChange={e => setSettings(prev => ({ ...prev, brightness: Number(e.target.value) }))}
                />
                <span>{Math.round(settings.brightness * 100)}%</span>
              </div>
            </div>

            <div className="am-option-row">
              <label>Particle density</label>
              <div className="am-slider-control">
                <input
                  type="range"
                  min="0.2"
                  max="1"
                  step="0.1"
                  value={settings.particleDensity}
                  onChange={e => setSettings(prev => ({ ...prev, particleDensity: Number(e.target.value) }))}
                />
                <span>{Math.round(settings.particleDensity * 100)}%</span>
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="am-section am-preview-section">
            <h3>Preview</h3>
            <button
              className="am-preview-btn"
              onClick={() => setIsPreviewActive(true)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Start Preview
            </button>
            <p className="am-hint">Press Escape to exit preview</p>
          </div>
        </div>

        {/* Footer */}
        <div className="am-footer">
          <div className="am-footer-info">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            <span>
              {settings.enabled
                ? `Activates after ${settings.idleTimeout} minutes of inactivity`
                : 'Ambient mode is disabled'
              }
            </span>
          </div>
        </div>
      </div>

      {/* Preview Overlay */}
      {isPreviewActive && (
        <div className="am-preview-overlay" onClick={() => setIsPreviewActive(false)}>
          <div className="am-preview-content">
            {/* Animated Orb Preview */}
            <div className="am-orb-container" style={{ opacity: settings.brightness }}>
              <div 
                className={`am-orb am-orb-${settings.colorMode}`}
                style={{
                  animationDuration: `${10 / settings.animationSpeed}s`,
                }}
              >
                {Array.from({ length: Math.round(100 * settings.particleDensity) }).map((_, i) => (
                  <div
                    key={i}
                    className="am-particle"
                    style={{
                      '--delay': `${Math.random() * 5}s`,
                      '--angle': `${Math.random() * 360}deg`,
                      '--distance': `${30 + Math.random() * 70}px`,
                      '--size': `${2 + Math.random() * 4}px`,
                    } as React.CSSProperties}
                  />
                ))}
              </div>
            </div>

            {/* Clock/Date Display */}
            {(settings.showClock || settings.showDate) && (
              <div className="am-info-display">
                {settings.showClock && (
                  <div className="am-clock">
                    {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
                {settings.showDate && (
                  <div className="am-date">
                    {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
                  </div>
                )}
                {settings.showWeather && (
                  <div className="am-weather">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="5" />
                      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2" />
                    </svg>
                    72F / Sunny
                  </div>
                )}
              </div>
            )}

            <div className="am-exit-hint">Press ESC or click to exit</div>
          </div>
        </div>
      )}
    </div>
  );
}
