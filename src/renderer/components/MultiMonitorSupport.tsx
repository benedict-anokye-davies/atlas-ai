/**
 * Atlas Desktop - Multi-Monitor Support Component
 * Configure orb position across multiple monitors
 */

import { useState, useEffect, useCallback } from 'react';
import './MultiMonitorSupport.css';

interface MultiMonitorSupportProps {
  isVisible: boolean;
  onClose: () => void;
}

interface Monitor {
  id: number;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  isPrimary: boolean;
  scaleFactor: number;
}

interface OrbPosition {
  monitor: number;
  anchor: 'top-left' | 'top-center' | 'top-right' | 'center-left' | 'center' | 'center-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
  offsetX: number;
  offsetY: number;
}

interface MultiMonitorSettings {
  autoDetect: boolean;
  currentPosition: OrbPosition;
  rememberPerMonitor: boolean;
  followMouse: boolean;
  snapToEdges: boolean;
}

export function MultiMonitorSupport({ isVisible, onClose }: MultiMonitorSupportProps) {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [settings, setSettings] = useState<MultiMonitorSettings>({
    autoDetect: true,
    currentPosition: {
      monitor: 0,
      anchor: 'bottom-right',
      offsetX: 50,
      offsetY: 50,
    },
    rememberPerMonitor: true,
    followMouse: false,
    snapToEdges: true,
  });
  const [selectedMonitor, setSelectedMonitor] = useState<number>(0);
  // Removed unused isDragging state

  // Detect monitors
  useEffect(() => {
    const detectMonitors = async () => {
      try {
        // In real implementation, use electron's screen API
        // For now, create mock data
        const mockMonitors: Monitor[] = [
          {
            id: 0,
            name: 'Primary Display',
            width: 2560,
            height: 1440,
            x: 0,
            y: 0,
            isPrimary: true,
            scaleFactor: 1.25,
          },
          {
            id: 1,
            name: 'Secondary Display',
            width: 1920,
            height: 1080,
            x: 2560,
            y: 180,
            isPrimary: false,
            scaleFactor: 1.0,
          },
        ];
        setMonitors(mockMonitors);
      } catch (err) {
        console.error('Failed to detect monitors:', err);
      }
    };

    if (isVisible) {
      detectMonitors();
    }
  }, [isVisible]);

  // Load settings
  useEffect(() => {
    try {
      const saved = localStorage.getItem('atlas-multimonitor-settings');
      if (saved) {
        setSettings(JSON.parse(saved));
      }
    } catch (err) {
      console.error('Failed to load multi-monitor settings:', err);
    }
  }, []);

  // Save settings
  useEffect(() => {
    localStorage.setItem('atlas-multimonitor-settings', JSON.stringify(settings));
  }, [settings]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isVisible) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isVisible, handleClose]);

  const getAnchorPosition = (anchor: OrbPosition['anchor']) => {
    const positions: Record<OrbPosition['anchor'], { x: number; y: number }> = {
      'top-left': { x: 10, y: 10 },
      'top-center': { x: 50, y: 10 },
      'top-right': { x: 90, y: 10 },
      'center-left': { x: 10, y: 50 },
      'center': { x: 50, y: 50 },
      'center-right': { x: 90, y: 50 },
      'bottom-left': { x: 10, y: 90 },
      'bottom-center': { x: 50, y: 90 },
      'bottom-right': { x: 90, y: 90 },
    };
    return positions[anchor];
  };

  const getMonitorBounds = () => {
    if (monitors.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const minX = Math.min(...monitors.map(m => m.x));
    const minY = Math.min(...monitors.map(m => m.y));
    const maxX = Math.max(...monitors.map(m => m.x + m.width));
    const maxY = Math.max(...monitors.map(m => m.y + m.height));
    return { minX, minY, maxX, maxY };
  };

  const bounds = getMonitorBounds();
  const totalWidth = bounds.maxX - bounds.minX;
  const totalHeight = bounds.maxY - bounds.minY;
  const scale = Math.min(400 / totalWidth, 200 / totalHeight);

  const handleMonitorClick = (monitorId: number) => {
    setSelectedMonitor(monitorId);
    setSettings(prev => ({
      ...prev,
      currentPosition: { ...prev.currentPosition, monitor: monitorId },
    }));
  };

  const handleAnchorChange = (anchor: OrbPosition['anchor']) => {
    setSettings(prev => ({
      ...prev,
      currentPosition: { ...prev.currentPosition, anchor },
    }));
  };

  if (!isVisible) return null;

  return (
    <div className="multimon-overlay" onClick={handleClose}>
      <div className="multimon-container" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="mm-header">
          <div className="mm-title-row">
            <svg className="mm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
            <h2>Multi-Monitor Setup</h2>
          </div>
          <button className="mm-close" onClick={handleClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mm-content">
          {/* Monitor Preview */}
          <div className="mm-preview-section">
            <h3>Monitor Layout</h3>
            <div className="mm-preview-container">
              <div
                className="mm-preview"
                style={{
                  width: totalWidth * scale,
                  height: totalHeight * scale,
                }}
              >
                {monitors.map(monitor => {
                  const pos = getAnchorPosition(settings.currentPosition.anchor);
                  const isSelected = selectedMonitor === monitor.id;
                  const hasOrb = settings.currentPosition.monitor === monitor.id;

                  return (
                    <div
                      key={monitor.id}
                      className={`mm-monitor ${isSelected ? 'selected' : ''} ${monitor.isPrimary ? 'primary' : ''}`}
                      style={{
                        width: monitor.width * scale,
                        height: monitor.height * scale,
                        left: (monitor.x - bounds.minX) * scale,
                        top: (monitor.y - bounds.minY) * scale,
                      }}
                      onClick={() => handleMonitorClick(monitor.id)}
                    >
                      <span className="mm-monitor-name">{monitor.name}</span>
                      <span className="mm-monitor-res">{monitor.width}x{monitor.height}</span>
                      {monitor.isPrimary && <span className="mm-primary-badge">Primary</span>}
                      {hasOrb && (
                        <div
                          className="mm-orb-preview"
                          style={{
                            left: `${pos.x}%`,
                            top: `${pos.y}%`,
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Position Settings */}
          <div className="mm-position-section">
            <h3>Orb Position</h3>
            
            <div className="mm-anchor-grid">
              {(['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'] as OrbPosition['anchor'][]).map(anchor => (
                <button
                  key={anchor}
                  className={`mm-anchor-btn ${settings.currentPosition.anchor === anchor ? 'active' : ''}`}
                  onClick={() => handleAnchorChange(anchor)}
                >
                  <div className="mm-anchor-dot" />
                </button>
              ))}
            </div>

            <div className="mm-offset-controls">
              <div className="mm-offset-row">
                <label>Horizontal Offset</label>
                <div className="mm-slider-control">
                  <input
                    type="range"
                    min="-200"
                    max="200"
                    value={settings.currentPosition.offsetX}
                    onChange={e => setSettings(prev => ({
                      ...prev,
                      currentPosition: { ...prev.currentPosition, offsetX: Number(e.target.value) },
                    }))}
                  />
                  <span>{settings.currentPosition.offsetX}px</span>
                </div>
              </div>
              <div className="mm-offset-row">
                <label>Vertical Offset</label>
                <div className="mm-slider-control">
                  <input
                    type="range"
                    min="-200"
                    max="200"
                    value={settings.currentPosition.offsetY}
                    onChange={e => setSettings(prev => ({
                      ...prev,
                      currentPosition: { ...prev.currentPosition, offsetY: Number(e.target.value) },
                    }))}
                  />
                  <span>{settings.currentPosition.offsetY}px</span>
                </div>
              </div>
            </div>
          </div>

          {/* Behavior Settings */}
          <div className="mm-behavior-section">
            <h3>Behavior</h3>
            
            <label className="mm-checkbox">
              <input
                type="checkbox"
                checked={settings.autoDetect}
                onChange={e => setSettings(prev => ({ ...prev, autoDetect: e.target.checked }))}
              />
              <span className="mm-checkmark"></span>
              <div className="mm-checkbox-info">
                <span>Auto-detect monitor changes</span>
                <p>Automatically adjust when monitors are connected or disconnected</p>
              </div>
            </label>

            <label className="mm-checkbox">
              <input
                type="checkbox"
                checked={settings.rememberPerMonitor}
                onChange={e => setSettings(prev => ({ ...prev, rememberPerMonitor: e.target.checked }))}
              />
              <span className="mm-checkmark"></span>
              <div className="mm-checkbox-info">
                <span>Remember position per monitor</span>
                <p>Save different positions for different monitor configurations</p>
              </div>
            </label>

            <label className="mm-checkbox">
              <input
                type="checkbox"
                checked={settings.followMouse}
                onChange={e => setSettings(prev => ({ ...prev, followMouse: e.target.checked }))}
              />
              <span className="mm-checkmark"></span>
              <div className="mm-checkbox-info">
                <span>Follow mouse to active monitor</span>
                <p>Move orb to the monitor where the mouse is located</p>
              </div>
            </label>

            <label className="mm-checkbox">
              <input
                type="checkbox"
                checked={settings.snapToEdges}
                onChange={e => setSettings(prev => ({ ...prev, snapToEdges: e.target.checked }))}
              />
              <span className="mm-checkmark"></span>
              <div className="mm-checkbox-info">
                <span>Snap to screen edges</span>
                <p>Snap orb position to screen edges when dragging</p>
              </div>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="mm-footer">
          <div className="mm-footer-info">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            <span>
              {monitors.length} monitor{monitors.length !== 1 ? 's' : ''} detected
              {monitors.find(m => m.isPrimary) && ` (Primary: ${monitors.find(m => m.isPrimary)?.name})`}
            </span>
          </div>
          <button
            className="mm-refresh-btn"
            onClick={() => {
              // Re-detect monitors
              setMonitors([...monitors]);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
