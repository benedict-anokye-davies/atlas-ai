/**
 * Atlas Desktop - Screen Context Panel
 * Shows what Atlas can see on screen - active window, detected elements, OCR text
 */

import { useState, useEffect, useCallback } from 'react';
import './ScreenContextPanel.css';

interface ScreenContextPanelProps {
  isVisible: boolean;
  onClose: () => void;
}

interface WindowInfo {
  title: string;
  processName: string;
  bounds: { x: number; y: number; width: number; height: number };
  isActive: boolean;
}

interface DetectedElement {
  type: 'button' | 'input' | 'link' | 'text' | 'image' | 'icon';
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  confidence: number;
}

interface OCRResult {
  text: string;
  bounds: { x: number; y: number; width: number; height: number };
  confidence: number;
}

interface ScreenContext {
  activeWindow: WindowInfo | null;
  visibleWindows: WindowInfo[];
  detectedElements: DetectedElement[];
  ocrResults: OCRResult[];
  screenshot: string | null;
  timestamp: number;
}

export function ScreenContextPanel({ isVisible, onClose }: ScreenContextPanelProps) {
  const [context, setContext] = useState<ScreenContext>({
    activeWindow: null,
    visibleWindows: [],
    detectedElements: [],
    ocrResults: [],
    screenshot: null,
    timestamp: 0,
  });
  const [isCapturing, setIsCapturing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'overview' | 'elements' | 'ocr' | 'raw'>('overview');
  const [highlightElement, setHighlightElement] = useState<number | null>(null);

  // Capture screen context
  const captureContext = useCallback(async () => {
    setIsCapturing(true);
    try {
      // Try to get real data from IPC - captureScreenContext may not be exposed yet
      const toolsAny = window.atlas?.tools as unknown as Record<string, unknown> | undefined;
      if (toolsAny?.captureScreenContext && typeof toolsAny.captureScreenContext === 'function') {
        const result = await (toolsAny.captureScreenContext as () => Promise<ScreenContext | null>)();
        if (result) {
          setContext(result);
          return;
        }
      }

      // Generate mock data for demo
      const mockContext: ScreenContext = {
        activeWindow: {
          title: 'Atlas Desktop - Development',
          processName: 'electron.exe',
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          isActive: true,
        },
        visibleWindows: [
          {
            title: 'Atlas Desktop - Development',
            processName: 'electron.exe',
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            isActive: true,
          },
          {
            title: 'Visual Studio Code',
            processName: 'Code.exe',
            bounds: { x: 100, y: 50, width: 1400, height: 900 },
            isActive: false,
          },
          {
            title: 'Google Chrome - GitHub',
            processName: 'chrome.exe',
            bounds: { x: 200, y: 100, width: 1200, height: 800 },
            isActive: false,
          },
        ],
        detectedElements: [
          { type: 'button', label: 'Start Listening', bounds: { x: 850, y: 600, width: 120, height: 40 }, confidence: 0.95 },
          { type: 'button', label: 'Settings', bounds: { x: 1800, y: 20, width: 80, height: 30 }, confidence: 0.92 },
          { type: 'text', label: 'Atlas Desktop', bounds: { x: 30, y: 20, width: 150, height: 30 }, confidence: 0.98 },
          { type: 'input', label: 'Search...', bounds: { x: 500, y: 20, width: 300, height: 35 }, confidence: 0.88 },
          { type: 'icon', label: 'Microphone', bounds: { x: 920, y: 480, width: 60, height: 60 }, confidence: 0.91 },
          { type: 'link', label: 'Documentation', bounds: { x: 1700, y: 25, width: 100, height: 20 }, confidence: 0.85 },
        ],
        ocrResults: [
          { text: 'Atlas Desktop', bounds: { x: 30, y: 20, width: 150, height: 30 }, confidence: 0.98 },
          { text: 'Voice-First AI Assistant', bounds: { x: 780, y: 200, width: 360, height: 40 }, confidence: 0.95 },
          { text: 'Press Space or say "Hey Atlas" to start', bounds: { x: 650, y: 650, width: 620, height: 25 }, confidence: 0.92 },
          { text: 'Idle', bounds: { x: 920, y: 550, width: 80, height: 25 }, confidence: 0.89 },
          { text: 'Settings | Help | About', bounds: { x: 1680, y: 25, width: 200, height: 20 }, confidence: 0.87 },
        ],
        screenshot: null, // Would be base64 encoded image
        timestamp: Date.now(),
      };
      setContext(mockContext);
    } catch (error) {
      console.error('Failed to capture screen context:', error);
    } finally {
      setIsCapturing(false);
    }
  }, []);

  // Auto-refresh effect
  useEffect(() => {
    if (!isVisible || !autoRefresh) return;

    const interval = setInterval(captureContext, 2000);
    return () => clearInterval(interval);
  }, [isVisible, autoRefresh, captureContext]);

  // Initial capture when opened
  useEffect(() => {
    if (isVisible && context.timestamp === 0) {
      captureContext();
    }
  }, [isVisible, context.timestamp, captureContext]);

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

  const getElementIcon = (type: DetectedElement['type']) => {
    switch (type) {
      case 'button': return '[ ]';
      case 'input': return '[_]';
      case 'link': return '(-)';
      case 'text': return 'Aa';
      case 'image': return '[#]';
      case 'icon': return '(*)';
      default: return '?';
    }
  };

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleTimeString();
  };

  return (
    <div className="screen-context-overlay" onClick={onClose}>
      <div className="screen-context-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="scp-header">
          <div className="scp-title-row">
            <svg className="scp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <h2>Screen Context</h2>
            {context.timestamp > 0 && (
              <span className="scp-timestamp">Last updated: {formatTimestamp(context.timestamp)}</span>
            )}
          </div>
          <div className="scp-header-actions">
            <label className="auto-refresh-toggle">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              <span>Auto-refresh</span>
            </label>
            <button 
              className="refresh-btn" 
              onClick={captureContext}
              disabled={isCapturing}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={isCapturing ? 'spinning' : ''}>
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
              {isCapturing ? 'Capturing...' : 'Refresh'}
            </button>
            <button className="scp-close" onClick={onClose}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="scp-tabs">
          {(['overview', 'elements', 'ocr', 'raw'] as const).map((tab) => (
            <button
              key={tab}
              className={`scp-tab ${selectedTab === tab ? 'active' : ''}`}
              onClick={() => setSelectedTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="scp-content">
          {selectedTab === 'overview' && (
            <div className="scp-overview">
              {/* Active Window */}
              <div className="context-section">
                <h3>Active Window</h3>
                {context.activeWindow ? (
                  <div className="active-window-card">
                    <div className="window-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <line x1="3" y1="9" x2="21" y2="9" />
                        <circle cx="6" cy="6" r="1" />
                        <circle cx="9" cy="6" r="1" />
                        <circle cx="12" cy="6" r="1" />
                      </svg>
                    </div>
                    <div className="window-info">
                      <div className="window-title">{context.activeWindow.title}</div>
                      <div className="window-process">{context.activeWindow.processName}</div>
                      <div className="window-bounds">
                        {context.activeWindow.bounds.width} x {context.activeWindow.bounds.height}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="no-data">No active window detected</p>
                )}
              </div>

              {/* Visible Windows */}
              <div className="context-section">
                <h3>Visible Windows ({context.visibleWindows.length})</h3>
                <div className="windows-list">
                  {context.visibleWindows.map((win, idx) => (
                    <div key={idx} className={`window-item ${win.isActive ? 'active' : ''}`}>
                      <div className="window-process-icon">
                        {win.processName.charAt(0).toUpperCase()}
                      </div>
                      <div className="window-details">
                        <div className="window-title">{win.title}</div>
                        <div className="window-meta">{win.processName}</div>
                      </div>
                      {win.isActive && <span className="active-badge">Active</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick Stats */}
              <div className="context-stats">
                <div className="stat-card">
                  <div className="stat-value">{context.detectedElements.length}</div>
                  <div className="stat-label">UI Elements</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{context.ocrResults.length}</div>
                  <div className="stat-label">Text Regions</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{context.visibleWindows.length}</div>
                  <div className="stat-label">Windows</div>
                </div>
              </div>
            </div>
          )}

          {selectedTab === 'elements' && (
            <div className="scp-elements">
              <div className="elements-header">
                <span>{context.detectedElements.length} elements detected</span>
              </div>
              <div className="elements-list">
                {context.detectedElements.map((el, idx) => (
                  <div
                    key={idx}
                    className={`element-item ${highlightElement === idx ? 'highlighted' : ''}`}
                    onMouseEnter={() => setHighlightElement(idx)}
                    onMouseLeave={() => setHighlightElement(null)}
                  >
                    <div className={`element-type type-${el.type}`}>
                      {getElementIcon(el.type)}
                    </div>
                    <div className="element-details">
                      <div className="element-label">{el.label}</div>
                      <div className="element-meta">
                        <span className="element-type-badge">{el.type}</span>
                        <span className="element-bounds">
                          ({el.bounds.x}, {el.bounds.y}) {el.bounds.width}x{el.bounds.height}
                        </span>
                      </div>
                    </div>
                    <div className="element-confidence">
                      <div 
                        className="confidence-bar" 
                        style={{ width: `${el.confidence * 100}%` }}
                      />
                      <span>{Math.round(el.confidence * 100)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedTab === 'ocr' && (
            <div className="scp-ocr">
              <div className="ocr-header">
                <span>{context.ocrResults.length} text regions detected</span>
              </div>
              <div className="ocr-list">
                {context.ocrResults.map((result, idx) => (
                  <div key={idx} className="ocr-item">
                    <div className="ocr-text">"{result.text}"</div>
                    <div className="ocr-meta">
                      <span className="ocr-bounds">
                        Position: ({result.bounds.x}, {result.bounds.y})
                      </span>
                      <span className="ocr-confidence">
                        Confidence: {Math.round(result.confidence * 100)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedTab === 'raw' && (
            <div className="scp-raw">
              <div className="raw-header">
                <span>Raw Context Data</span>
                <button 
                  className="copy-btn"
                  onClick={() => navigator.clipboard.writeText(JSON.stringify(context, null, 2))}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  Copy
                </button>
              </div>
              <pre className="raw-json">
                {JSON.stringify(context, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="scp-footer">
          <div className="scp-hint">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
            <span>Atlas uses screen context to better understand your requests</span>
          </div>
        </div>
      </div>
    </div>
  );
}
