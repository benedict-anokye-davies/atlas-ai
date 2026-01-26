/**
 * Atlas Desktop - Theme Customization System
 * Comprehensive theme, color, and appearance settings
 */

import React, { useState, useEffect, useCallback } from 'react';
import './ThemeCustomization.css';

// ============================================================================
// Types
// ============================================================================

export type ThemeMode = 'light' | 'dark' | 'system';
export type OrbStyle = 'default' | 'minimal' | 'cosmic' | 'neon' | 'nature';
export type AccentColor = 'purple' | 'blue' | 'green' | 'orange' | 'pink' | 'red' | 'custom';

export interface ThemeConfig {
  mode: ThemeMode;
  orbStyle: OrbStyle;
  accentColor: AccentColor;
  customAccent?: string;
  transparency: number;
  blur: number;
  animations: boolean;
  reducedMotion: boolean;
  fontSize: 'small' | 'medium' | 'large';
  fontFamily: 'system' | 'inter' | 'roboto' | 'mono';
  compactMode: boolean;
}

interface ThemeCustomizationProps {
  isVisible: boolean;
  onClose: () => void;
}

// ============================================================================
// Default Config
// ============================================================================

const DEFAULT_CONFIG: ThemeConfig = {
  mode: 'dark',
  orbStyle: 'default',
  accentColor: 'purple',
  transparency: 85,
  blur: 12,
  animations: true,
  reducedMotion: false,
  fontSize: 'medium',
  fontFamily: 'system',
  compactMode: false,
};

// ============================================================================
// Icons
// ============================================================================

const SunIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

const MoonIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const MonitorIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

const PaletteIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="13.5" cy="6.5" r="2.5" />
    <circle cx="17.5" cy="10.5" r="2.5" />
    <circle cx="8.5" cy="7.5" r="2.5" />
    <circle cx="6.5" cy="12.5" r="2.5" />
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z" />
  </svg>
);

const SparklesIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z" />
    <path d="M5 3v4" />
    <path d="M3 5h4" />
    <path d="M19 17v4" />
    <path d="M17 19h4" />
  </svg>
);

const TypeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="4 7 4 4 20 4 20 7" />
    <line x1="9" y1="20" x2="15" y2="20" />
    <line x1="12" y1="4" x2="12" y2="20" />
  </svg>
);

const LayoutIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="9" y1="21" x2="9" y2="9" />
  </svg>
);

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const CheckIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const RefreshIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

// ============================================================================
// Color Presets
// ============================================================================

const ACCENT_COLORS: Record<AccentColor, { primary: string; gradient: string; name: string }> = {
  purple: { primary: '#8b5cf6', gradient: 'linear-gradient(135deg, #8b5cf6, #6366f1)', name: 'Purple' },
  blue: { primary: '#3b82f6', gradient: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', name: 'Blue' },
  green: { primary: '#22c55e', gradient: 'linear-gradient(135deg, #22c55e, #16a34a)', name: 'Green' },
  orange: { primary: '#f59e0b', gradient: 'linear-gradient(135deg, #f59e0b, #d97706)', name: 'Orange' },
  pink: { primary: '#ec4899', gradient: 'linear-gradient(135deg, #ec4899, #db2777)', name: 'Pink' },
  red: { primary: '#ef4444', gradient: 'linear-gradient(135deg, #ef4444, #dc2626)', name: 'Red' },
  custom: { primary: '#8b5cf6', gradient: 'linear-gradient(135deg, #8b5cf6, #6366f1)', name: 'Custom' },
};

const ORB_STYLES: Record<OrbStyle, { preview: string; name: string; description: string }> = {
  default: { preview: 'default', name: 'Default', description: 'Classic particle system' },
  minimal: { preview: 'minimal', name: 'Minimal', description: 'Simple, clean look' },
  cosmic: { preview: 'cosmic', name: 'Cosmic', description: 'Space-themed effects' },
  neon: { preview: 'neon', name: 'Neon', description: 'Vibrant glow effects' },
  nature: { preview: 'nature', name: 'Nature', description: 'Organic, flowing particles' },
};

// ============================================================================
// Main Component
// ============================================================================

export const ThemeCustomization: React.FC<ThemeCustomizationProps> = ({ isVisible, onClose }) => {
  const [config, setConfig] = useState<ThemeConfig>(DEFAULT_CONFIG);
  const [activeTab, setActiveTab] = useState<'theme' | 'colors' | 'orb' | 'typography' | 'advanced'>('theme');
  const [hasChanges, setHasChanges] = useState(false);

  // Apply config changes - defined before useEffect that uses it
  const applyConfig = useCallback((newConfig: ThemeConfig) => {
    // Apply CSS variables
    const root = document.documentElement;
    const accent = ACCENT_COLORS[newConfig.accentColor];
    
    root.style.setProperty('--accent-primary', newConfig.customAccent || accent.primary);
    root.style.setProperty('--accent-gradient', accent.gradient);
    root.style.setProperty('--transparency', `${newConfig.transparency}%`);
    root.style.setProperty('--blur', `${newConfig.blur}px`);
    
    // Font size
    const fontSizes = { small: '14px', medium: '16px', large: '18px' };
    root.style.setProperty('--base-font-size', fontSizes[newConfig.fontSize]);
    
    // Reduced motion
    if (newConfig.reducedMotion) {
      root.classList.add('reduced-motion');
    } else {
      root.classList.remove('reduced-motion');
    }
    
    // Theme mode
    root.setAttribute('data-theme', newConfig.mode === 'system' ? 
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') :
      newConfig.mode
    );
    
    // Compact mode
    if (newConfig.compactMode) {
      root.classList.add('compact');
    } else {
      root.classList.remove('compact');
    }
  }, []);

  // Load saved config
  useEffect(() => {
    const loadConfig = async () => {
      try {
        // Use localStorage as primary storage for theme config
        const stored = localStorage.getItem('atlas:theme-config');
        if (stored) {
          const parsed = JSON.parse(stored);
          setConfig(parsed);
          applyConfig(parsed);
        }
      } catch (error) {
        console.error('Failed to load theme config:', error);
      }
    };
    loadConfig();
  }, [applyConfig]);

  // Update config
  const updateConfig = useCallback((updates: Partial<ThemeConfig>) => {
    setConfig(prev => {
      const newConfig = { ...prev, ...updates };
      applyConfig(newConfig);
      setHasChanges(true);
      return newConfig;
    });
  }, [applyConfig]);

  // Save config
  const saveConfig = useCallback(async () => {
    try {
      // Save to localStorage
      localStorage.setItem('atlas:theme-config', JSON.stringify(config));
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save theme config:', error);
    }
  }, [config]);

  // Reset to defaults
  const resetConfig = useCallback(() => {
    setConfig(DEFAULT_CONFIG);
    applyConfig(DEFAULT_CONFIG);
    setHasChanges(true);
  }, [applyConfig]);

  if (!isVisible) return null;

  return (
    <div className="theme-overlay">
      <div className="theme-container">
        {/* Header */}
        <div className="theme-header">
          <div className="header-title-row">
            <PaletteIcon className="header-icon" />
            <h2 className="header-title">Appearance</h2>
          </div>
          <div className="header-actions">
            {hasChanges && (
              <button className="save-btn" onClick={saveConfig}>
                <CheckIcon className="btn-icon" />
                Save Changes
              </button>
            )}
            <button className="close-btn" onClick={onClose}>
              <XIcon className="close-icon" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="theme-tabs">
          <button 
            className={`theme-tab ${activeTab === 'theme' ? 'active' : ''}`}
            onClick={() => setActiveTab('theme')}
          >
            <MoonIcon className="tab-icon" />
            Theme
          </button>
          <button 
            className={`theme-tab ${activeTab === 'colors' ? 'active' : ''}`}
            onClick={() => setActiveTab('colors')}
          >
            <PaletteIcon className="tab-icon" />
            Colors
          </button>
          <button 
            className={`theme-tab ${activeTab === 'orb' ? 'active' : ''}`}
            onClick={() => setActiveTab('orb')}
          >
            <SparklesIcon className="tab-icon" />
            Orb
          </button>
          <button 
            className={`theme-tab ${activeTab === 'typography' ? 'active' : ''}`}
            onClick={() => setActiveTab('typography')}
          >
            <TypeIcon className="tab-icon" />
            Typography
          </button>
          <button 
            className={`theme-tab ${activeTab === 'advanced' ? 'active' : ''}`}
            onClick={() => setActiveTab('advanced')}
          >
            <LayoutIcon className="tab-icon" />
            Advanced
          </button>
        </div>

        {/* Content */}
        <div className="theme-content">
          {/* Theme Mode */}
          {activeTab === 'theme' && (
            <div className="tab-content">
              <div className="section">
                <h3 className="section-title">Theme Mode</h3>
                <p className="section-desc">Choose your preferred color scheme</p>
                
                <div className="mode-options">
                  <button 
                    className={`mode-option ${config.mode === 'light' ? 'active' : ''}`}
                    onClick={() => updateConfig({ mode: 'light' })}
                  >
                    <SunIcon className="mode-icon" />
                    <span className="mode-label">Light</span>
                  </button>
                  <button 
                    className={`mode-option ${config.mode === 'dark' ? 'active' : ''}`}
                    onClick={() => updateConfig({ mode: 'dark' })}
                  >
                    <MoonIcon className="mode-icon" />
                    <span className="mode-label">Dark</span>
                  </button>
                  <button 
                    className={`mode-option ${config.mode === 'system' ? 'active' : ''}`}
                    onClick={() => updateConfig({ mode: 'system' })}
                  >
                    <MonitorIcon className="mode-icon" />
                    <span className="mode-label">System</span>
                  </button>
                </div>
              </div>

              <div className="section">
                <h3 className="section-title">Window Effects</h3>
                
                <div className="slider-control">
                  <label className="slider-label">
                    <span>Transparency</span>
                    <span className="slider-value">{config.transparency}%</span>
                  </label>
                  <input 
                    type="range"
                    min="50"
                    max="100"
                    value={config.transparency}
                    onChange={(e) => updateConfig({ transparency: parseInt(e.target.value) })}
                    className="slider"
                  />
                </div>

                <div className="slider-control">
                  <label className="slider-label">
                    <span>Background Blur</span>
                    <span className="slider-value">{config.blur}px</span>
                  </label>
                  <input 
                    type="range"
                    min="0"
                    max="24"
                    value={config.blur}
                    onChange={(e) => updateConfig({ blur: parseInt(e.target.value) })}
                    className="slider"
                  />
                </div>
              </div>

              <div className="section">
                <h3 className="section-title">Motion</h3>
                
                <div className="toggle-row">
                  <div className="toggle-info">
                    <span className="toggle-label">Enable Animations</span>
                    <span className="toggle-desc">Smooth transitions and effects</span>
                  </div>
                  <button 
                    className={`toggle ${config.animations ? 'active' : ''}`}
                    onClick={() => updateConfig({ animations: !config.animations })}
                  >
                    <span className="toggle-handle" />
                  </button>
                </div>

                <div className="toggle-row">
                  <div className="toggle-info">
                    <span className="toggle-label">Reduced Motion</span>
                    <span className="toggle-desc">Minimize animations for accessibility</span>
                  </div>
                  <button 
                    className={`toggle ${config.reducedMotion ? 'active' : ''}`}
                    onClick={() => updateConfig({ reducedMotion: !config.reducedMotion })}
                  >
                    <span className="toggle-handle" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Colors */}
          {activeTab === 'colors' && (
            <div className="tab-content">
              <div className="section">
                <h3 className="section-title">Accent Color</h3>
                <p className="section-desc">Customize the primary accent color</p>
                
                <div className="color-grid">
                  {(Object.keys(ACCENT_COLORS) as AccentColor[]).filter(c => c !== 'custom').map(color => (
                    <button
                      key={color}
                      className={`color-option ${config.accentColor === color ? 'active' : ''}`}
                      onClick={() => updateConfig({ accentColor: color })}
                      style={{ background: ACCENT_COLORS[color].gradient }}
                    >
                      {config.accentColor === color && <CheckIcon className="check-icon" />}
                      <span className="color-name">{ACCENT_COLORS[color].name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="section">
                <h3 className="section-title">Custom Color</h3>
                <div className="custom-color-row">
                  <input
                    type="color"
                    value={config.customAccent || ACCENT_COLORS[config.accentColor].primary}
                    onChange={(e) => updateConfig({ accentColor: 'custom', customAccent: e.target.value })}
                    className="color-picker"
                  />
                  <input
                    type="text"
                    value={config.customAccent || ACCENT_COLORS[config.accentColor].primary}
                    onChange={(e) => updateConfig({ accentColor: 'custom', customAccent: e.target.value })}
                    placeholder="#8b5cf6"
                    className="color-input"
                  />
                </div>
              </div>

              <div className="section">
                <h3 className="section-title">Preview</h3>
                <div className="color-preview" style={{ background: config.customAccent || ACCENT_COLORS[config.accentColor].gradient }}>
                  <div className="preview-content">
                    <span className="preview-label">Accent Color Preview</span>
                    <button className="preview-button">Sample Button</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Orb Style */}
          {activeTab === 'orb' && (
            <div className="tab-content">
              <div className="section">
                <h3 className="section-title">Orb Style</h3>
                <p className="section-desc">Choose the visual style for the AI orb</p>
                
                <div className="orb-grid">
                  {(Object.keys(ORB_STYLES) as OrbStyle[]).map(style => (
                    <button
                      key={style}
                      className={`orb-option ${config.orbStyle === style ? 'active' : ''}`}
                      onClick={() => updateConfig({ orbStyle: style })}
                    >
                      <div className={`orb-preview ${style}`}>
                        <div className="orb-sphere" />
                      </div>
                      <span className="orb-name">{ORB_STYLES[style].name}</span>
                      <span className="orb-desc">{ORB_STYLES[style].description}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Typography */}
          {activeTab === 'typography' && (
            <div className="tab-content">
              <div className="section">
                <h3 className="section-title">Font Size</h3>
                
                <div className="font-size-options">
                  {(['small', 'medium', 'large'] as const).map(size => (
                    <button
                      key={size}
                      className={`font-size-option ${config.fontSize === size ? 'active' : ''}`}
                      onClick={() => updateConfig({ fontSize: size })}
                    >
                      <span className={`font-preview ${size}`}>Aa</span>
                      <span className="font-label">{size.charAt(0).toUpperCase() + size.slice(1)}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="section">
                <h3 className="section-title">Font Family</h3>
                
                <div className="font-family-options">
                  {(['system', 'inter', 'roboto', 'mono'] as const).map(family => (
                    <button
                      key={family}
                      className={`font-family-option ${config.fontFamily === family ? 'active' : ''}`}
                      onClick={() => updateConfig({ fontFamily: family })}
                    >
                      <span className={`family-preview font-${family}`}>
                        The quick brown fox
                      </span>
                      <span className="family-label">
                        {family === 'system' ? 'System Default' : 
                         family === 'inter' ? 'Inter' :
                         family === 'roboto' ? 'Roboto' : 'Monospace'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Advanced */}
          {activeTab === 'advanced' && (
            <div className="tab-content">
              <div className="section">
                <h3 className="section-title">Layout</h3>
                
                <div className="toggle-row">
                  <div className="toggle-info">
                    <span className="toggle-label">Compact Mode</span>
                    <span className="toggle-desc">Reduce padding and spacing</span>
                  </div>
                  <button 
                    className={`toggle ${config.compactMode ? 'active' : ''}`}
                    onClick={() => updateConfig({ compactMode: !config.compactMode })}
                  >
                    <span className="toggle-handle" />
                  </button>
                </div>
              </div>

              <div className="section">
                <h3 className="section-title">Reset</h3>
                <p className="section-desc">Restore all settings to their defaults</p>
                
                <button className="reset-btn" onClick={resetConfig}>
                  <RefreshIcon className="btn-icon" />
                  Reset to Defaults
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ThemeCustomization;
