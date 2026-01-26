/**
 * Atlas Desktop - Gesture Controls Component
 * Configure webcam-based gesture recognition for hands-free control
 */

import { useState, useEffect, useCallback } from 'react';
import './GestureControls.css';

interface GestureControlsProps {
  isVisible: boolean;
  onClose: () => void;
}

interface GestureBinding {
  id: string;
  gesture: string;
  action: string;
  enabled: boolean;
  sensitivity: number;
}

interface GestureSettings {
  enabled: boolean;
  cameraId: string | null;
  showPreview: boolean;
  showOverlay: boolean;
  detectionInterval: number;
  confidenceThreshold: number;
  gestureBindings: GestureBinding[];
}

const DEFAULT_GESTURES = [
  { id: 'wave', gesture: 'wave', name: 'Wave', description: 'Wave hand left-right', icon: 'M5 12h14M12 5l7 7-7 7' },
  { id: 'thumbsup', gesture: 'thumbs_up', name: 'Thumbs Up', description: 'Thumbs up gesture', icon: 'M14 10V4.5a2.5 2.5 0 00-5 0V10M5 15h3l1-5h6l1 5h3' },
  { id: 'thumbsdown', gesture: 'thumbs_down', name: 'Thumbs Down', description: 'Thumbs down gesture', icon: 'M10 14v5.5a2.5 2.5 0 005 0V14M5 9h3l1 5h6l1-5h3' },
  { id: 'fist', gesture: 'closed_fist', name: 'Closed Fist', description: 'Make a fist', icon: 'M9.5 9.5a2.5 2.5 0 115 0v5a2.5 2.5 0 01-5 0v-5z' },
  { id: 'openpalm', gesture: 'open_palm', name: 'Open Palm', description: 'Show open palm', icon: 'M7 11V7a2 2 0 014 0v4M13 11V7a2 2 0 014 0v4M7 11v5a3 3 0 006 0v-5' },
  { id: 'pointup', gesture: 'point_up', name: 'Point Up', description: 'Point finger upward', icon: 'M12 5v14M12 5l-4 4M12 5l4 4' },
  { id: 'peace', gesture: 'peace', name: 'Peace Sign', description: 'Victory/peace sign', icon: 'M9 11v-5a2 2 0 014 0v5M9 11v4M13 11v4M9 15h4' },
  { id: 'pinch', gesture: 'pinch', name: 'Pinch', description: 'Pinch thumb and finger', icon: 'M12 12l-3-3m3 3l3-3m-3 3v6' },
];

const AVAILABLE_ACTIONS = [
  { id: 'wake', name: 'Wake Atlas', description: 'Activate voice listening' },
  { id: 'stop', name: 'Stop Listening', description: 'Cancel current operation' },
  { id: 'confirm', name: 'Confirm/Yes', description: 'Confirm an action' },
  { id: 'cancel', name: 'Cancel/No', description: 'Cancel or deny' },
  { id: 'scroll_up', name: 'Scroll Up', description: 'Scroll content up' },
  { id: 'scroll_down', name: 'Scroll Down', description: 'Scroll content down' },
  { id: 'next', name: 'Next', description: 'Go to next item' },
  { id: 'previous', name: 'Previous', description: 'Go to previous item' },
  { id: 'play_pause', name: 'Play/Pause', description: 'Toggle media playback' },
  { id: 'mute', name: 'Mute', description: 'Toggle mute' },
  { id: 'volume_up', name: 'Volume Up', description: 'Increase volume' },
  { id: 'volume_down', name: 'Volume Down', description: 'Decrease volume' },
];

export function GestureControls({ isVisible, onClose }: GestureControlsProps) {
  const [settings, setSettings] = useState<GestureSettings>({
    enabled: false,
    cameraId: null,
    showPreview: true,
    showOverlay: true,
    detectionInterval: 100,
    confidenceThreshold: 0.7,
    gestureBindings: DEFAULT_GESTURES.map((g, i) => ({
      id: g.id,
      gesture: g.gesture,
      action: i < AVAILABLE_ACTIONS.length ? AVAILABLE_ACTIONS[i].id : '',
      enabled: i < 3,
      sensitivity: 0.7,
    })),
  });
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationGesture, setCalibrationGesture] = useState<string | null>(null);
  const [detectedGesture, setDetectedGesture] = useState<string | null>(null);
  const [expandedBinding, setExpandedBinding] = useState<string | null>(null);

  // Load settings and enumerate cameras
  useEffect(() => {
    const loadSettings = () => {
      try {
        const saved = localStorage.getItem('atlas-gesture-settings');
        if (saved) {
          setSettings(JSON.parse(saved));
        }
      } catch (err) {
        console.error('Failed to load gesture settings:', err);
      }
    };

    const enumerateCameras = async () => {
      try {
        // Request permission first
        await navigator.mediaDevices.getUserMedia({ video: true })
          .then(stream => stream.getTracks().forEach(t => t.stop()));
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        setCameras(videoDevices);
        
        if (videoDevices.length > 0 && !settings.cameraId) {
          setSettings(prev => ({ ...prev, cameraId: videoDevices[0].deviceId }));
        }
      } catch (err) {
        console.error('Failed to enumerate cameras:', err);
      }
    };

    loadSettings();
    if (isVisible) {
      enumerateCameras();
    }
  }, [isVisible]);

  // Save settings
  useEffect(() => {
    localStorage.setItem('atlas-gesture-settings', JSON.stringify(settings));
  }, [settings]);

  // Simulate gesture detection for demo
  useEffect(() => {
    if (!isCalibrating || !calibrationGesture) return;
    
    const timeout = setTimeout(() => {
      setDetectedGesture(calibrationGesture);
      setTimeout(() => {
        setIsCalibrating(false);
        setCalibrationGesture(null);
        setDetectedGesture(null);
      }, 1500);
    }, 2000);

    return () => clearTimeout(timeout);
  }, [isCalibrating, calibrationGesture]);

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

  const updateBinding = (id: string, updates: Partial<GestureBinding>) => {
    setSettings(prev => ({
      ...prev,
      gestureBindings: prev.gestureBindings.map(b =>
        b.id === id ? { ...b, ...updates } : b
      ),
    }));
  };

  const startCalibration = (gestureId: string) => {
    setCalibrationGesture(gestureId);
    setIsCalibrating(true);
    setDetectedGesture(null);
  };

  const getGestureInfo = (gestureId: string) => {
    return DEFAULT_GESTURES.find(g => g.id === gestureId);
  };

  const getActionInfo = (actionId: string) => {
    return AVAILABLE_ACTIONS.find(a => a.id === actionId);
  };

  if (!isVisible) return null;

  return (
    <div className="gesture-overlay" onClick={handleClose}>
      <div className="gesture-container" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="gc-header">
          <div className="gc-title-row">
            <svg className="gc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 11V7a5 5 0 0110 0v4M5 12a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2v-8z" />
              <circle cx="9" cy="16" r="1" />
              <circle cx="15" cy="16" r="1" />
            </svg>
            <h2>Gesture Controls</h2>
          </div>
          <button className="gc-close" onClick={handleClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Enable Toggle */}
        <div className="gc-enable-section">
          <div className="gc-enable-info">
            <h3>Enable Gesture Recognition</h3>
            <p>Use hand gestures to control Atlas hands-free via your webcam</p>
          </div>
          <label className="gc-toggle">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={e => setSettings(prev => ({ ...prev, enabled: e.target.checked }))}
            />
            <span className="gc-toggle-slider"></span>
          </label>
        </div>

        {settings.enabled && (
          <>
            {/* Camera Selection */}
            <div className="gc-section">
              <h3>Camera</h3>
              <div className="gc-camera-row">
                <select
                  value={settings.cameraId || ''}
                  onChange={e => setSettings(prev => ({ ...prev, cameraId: e.target.value }))}
                  className="gc-select"
                >
                  {cameras.length === 0 ? (
                    <option value="">No cameras found</option>
                  ) : (
                    cameras.map(cam => (
                      <option key={cam.deviceId} value={cam.deviceId}>
                        {cam.label || `Camera ${cam.deviceId.slice(0, 8)}`}
                      </option>
                    ))
                  )}
                </select>
                <div className="gc-camera-options">
                  <label className="gc-checkbox">
                    <input
                      type="checkbox"
                      checked={settings.showPreview}
                      onChange={e => setSettings(prev => ({ ...prev, showPreview: e.target.checked }))}
                    />
                    <span>Show preview</span>
                  </label>
                  <label className="gc-checkbox">
                    <input
                      type="checkbox"
                      checked={settings.showOverlay}
                      onChange={e => setSettings(prev => ({ ...prev, showOverlay: e.target.checked }))}
                    />
                    <span>Show overlay</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Detection Settings */}
            <div className="gc-section">
              <h3>Detection Settings</h3>
              <div className="gc-sliders">
                <div className="gc-slider-row">
                  <label>Detection Interval</label>
                  <div className="gc-slider-control">
                    <input
                      type="range"
                      min="50"
                      max="500"
                      step="50"
                      value={settings.detectionInterval}
                      onChange={e => setSettings(prev => ({ ...prev, detectionInterval: Number(e.target.value) }))}
                    />
                    <span>{settings.detectionInterval}ms</span>
                  </div>
                </div>
                <div className="gc-slider-row">
                  <label>Confidence Threshold</label>
                  <div className="gc-slider-control">
                    <input
                      type="range"
                      min="0.3"
                      max="0.95"
                      step="0.05"
                      value={settings.confidenceThreshold}
                      onChange={e => setSettings(prev => ({ ...prev, confidenceThreshold: Number(e.target.value) }))}
                    />
                    <span>{Math.round(settings.confidenceThreshold * 100)}%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Gesture Bindings */}
            <div className="gc-section gc-bindings-section">
              <h3>Gesture Bindings</h3>
              <p className="gc-section-desc">Assign actions to hand gestures</p>
              
              <div className="gc-bindings-list">
                {settings.gestureBindings.map(binding => {
                  const gestureInfo = getGestureInfo(binding.id);
                  const actionInfo = getActionInfo(binding.action);
                  const isExpanded = expandedBinding === binding.id;

                  return (
                    <div
                      key={binding.id}
                      className={`gc-binding-card ${binding.enabled ? 'enabled' : ''} ${isExpanded ? 'expanded' : ''}`}
                    >
                      <div
                        className="gc-binding-header"
                        onClick={() => setExpandedBinding(isExpanded ? null : binding.id)}
                      >
                        <div className="gc-binding-toggle">
                          <label className="gc-mini-toggle" onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={binding.enabled}
                              onChange={e => updateBinding(binding.id, { enabled: e.target.checked })}
                            />
                            <span className="gc-mini-toggle-slider"></span>
                          </label>
                        </div>
                        <div className="gc-binding-gesture">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d={gestureInfo?.icon || 'M12 12'} />
                          </svg>
                          <span>{gestureInfo?.name}</span>
                        </div>
                        <div className="gc-binding-arrow">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M5 12h14M12 5l7 7-7 7" />
                          </svg>
                        </div>
                        <div className="gc-binding-action">
                          <span>{actionInfo?.name || 'No action'}</span>
                        </div>
                        <svg
                          className={`gc-binding-expand ${isExpanded ? 'rotated' : ''}`}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </div>

                      {isExpanded && (
                        <div className="gc-binding-details">
                          <p className="gc-gesture-desc">{gestureInfo?.description}</p>
                          
                          <div className="gc-binding-options">
                            <div className="gc-option-row">
                              <label>Action</label>
                              <select
                                value={binding.action}
                                onChange={e => updateBinding(binding.id, { action: e.target.value })}
                                className="gc-select"
                              >
                                <option value="">None</option>
                                {AVAILABLE_ACTIONS.map(action => (
                                  <option key={action.id} value={action.id}>
                                    {action.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            
                            <div className="gc-option-row">
                              <label>Sensitivity</label>
                              <div className="gc-sensitivity-control">
                                <input
                                  type="range"
                                  min="0.3"
                                  max="1"
                                  step="0.1"
                                  value={binding.sensitivity}
                                  onChange={e => updateBinding(binding.id, { sensitivity: Number(e.target.value) })}
                                />
                                <span>{Math.round(binding.sensitivity * 100)}%</span>
                              </div>
                            </div>

                            <button
                              className="gc-calibrate-btn"
                              onClick={() => startCalibration(binding.id)}
                              disabled={isCalibrating}
                            >
                              {isCalibrating && calibrationGesture === binding.id ? (
                                <>
                                  <div className="gc-calibrate-spinner"></div>
                                  {detectedGesture ? 'Detected!' : 'Perform gesture...'}
                                </>
                              ) : (
                                <>
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10" />
                                    <path d="M12 16v-4M12 8h.01" />
                                  </svg>
                                  Calibrate
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* Footer */}
        <div className="gc-footer">
          <div className="gc-footer-info">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            <span>
              {settings.enabled
                ? `${settings.gestureBindings.filter(b => b.enabled).length} gestures active`
                : 'Gesture recognition is disabled'
              }
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
