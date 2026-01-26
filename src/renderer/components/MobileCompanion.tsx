/**
 * Atlas Desktop - Mobile Companion Settings
 * UI for managing mobile API and device pairing
 */

import React, { useState, useEffect, useCallback } from 'react';
import './MobileCompanion.css';

// ============================================================================
// Types
// ============================================================================

interface ConnectedDevice {
  id: string;
  name: string;
  lastSeen: number;
}

interface MobileAPIState {
  enabled: boolean;
  port: number;
  pairingCode: string | null;
  connectedDevices: ConnectedDevice[];
}

interface MobileCompanionProps {
  isVisible: boolean;
  onClose: () => void;
}

// ============================================================================
// Icons
// ============================================================================

const SmartphoneIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
    <line x1="12" y1="18" x2="12.01" y2="18" />
  </svg>
);

const WifiIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M5 12.55a11 11 0 0 1 14.08 0" />
    <path d="M1.42 9a16 16 0 0 1 21.16 0" />
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
    <line x1="12" y1="20" x2="12.01" y2="20" />
  </svg>
);

// QRCodeIcon removed - not currently used

const CopyIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const RefreshIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

const TrashIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
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

const PowerIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
    <line x1="12" y1="2" x2="12" y2="12" />
  </svg>
);

// ============================================================================
// Main Component
// ============================================================================

export const MobileCompanion: React.FC<MobileCompanionProps> = ({ isVisible, onClose }) => {
  const [state, setState] = useState<MobileAPIState>({
    enabled: false,
    port: 3847,
    pairingCode: null,
    connectedDevices: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [ipAddress, setIpAddress] = useState<string>('Loading...');

  // Load state on mount
  useEffect(() => {
    if (isVisible) {
      loadState();
      loadIPAddress();
    }
  }, [isVisible]);

  const loadState = async () => {
    setIsLoading(true);
    try {
      // Try to get state from IPC if available, otherwise use localStorage
      const stored = localStorage.getItem('atlas:mobile-api-state');
      if (stored) {
        setState(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Failed to load mobile API state:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadIPAddress = async () => {
    try {
      // Attempt to get local IP - fallback to placeholder
      // Note: This would need a proper IPC call in the real implementation
      setIpAddress('192.168.x.x');
    } catch {
      setIpAddress('192.168.x.x');
    }
  };

  const toggleServer = async () => {
    try {
      // Toggle server state in localStorage for now
      const newState = { ...state, enabled: !state.enabled };
      if (!state.enabled) {
        // Generate a pairing code when starting
        newState.pairingCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      }
      setState(newState);
      localStorage.setItem('atlas:mobile-api-state', JSON.stringify(newState));
    } catch (error) {
      console.error('Failed to toggle server:', error);
    }
  };

  const regeneratePairingCode = async () => {
    try {
      const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      const newState = { ...state, pairingCode: newCode };
      setState(newState);
      localStorage.setItem('atlas:mobile-api-state', JSON.stringify(newState));
    } catch (error) {
      console.error('Failed to regenerate pairing code:', error);
    }
  };

  const disconnectDevice = async (deviceId: string) => {
    try {
      const newState = {
        ...state,
        connectedDevices: state.connectedDevices.filter(d => d.id !== deviceId)
      };
      setState(newState);
      localStorage.setItem('atlas:mobile-api-state', JSON.stringify(newState));
    } catch (error) {
      console.error('Failed to disconnect device:', error);
    }
  };

  const copyConnectionInfo = useCallback(() => {
    const info = `Atlas Desktop\nIP: ${ipAddress}\nPort: ${state.port}\nPairing Code: ${state.pairingCode}`;
    navigator.clipboard.writeText(info);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [ipAddress, state.port, state.pairingCode]);

  const formatLastSeen = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  if (!isVisible) return null;

  return (
    <div className="mobile-overlay">
      <div className="mobile-container">
        {/* Header */}
        <div className="mobile-header">
          <div className="header-title-row">
            <SmartphoneIcon className="header-icon" />
            <h2 className="header-title">Mobile Companion</h2>
          </div>
          <button className="close-btn" onClick={onClose}>
            <XIcon className="close-icon" />
          </button>
        </div>

        {/* Content */}
        <div className="mobile-content">
          {isLoading ? (
            <div className="loading-state">Loading...</div>
          ) : (
            <>
              {/* Server Status */}
              <div className="section">
                <div className="server-status">
                  <div className="status-indicator-row">
                    <div className={`status-dot ${state.enabled ? 'active' : ''}`} />
                    <span className="status-text">
                      {state.enabled ? 'Server Running' : 'Server Stopped'}
                    </span>
                  </div>
                  <button 
                    className={`power-btn ${state.enabled ? 'active' : ''}`}
                    onClick={toggleServer}
                  >
                    <PowerIcon className="power-icon" />
                    {state.enabled ? 'Stop Server' : 'Start Server'}
                  </button>
                </div>
              </div>

              {state.enabled && (
                <>
                  {/* Connection Info */}
                  <div className="section">
                    <h3 className="section-title">Connection Info</h3>
                    <div className="connection-info">
                      <div className="info-card">
                        <div className="info-icon-wrapper">
                          <WifiIcon className="info-icon" />
                        </div>
                        <div className="info-content">
                          <span className="info-label">IP Address</span>
                          <span className="info-value">{ipAddress}</span>
                        </div>
                      </div>
                      <div className="info-card">
                        <div className="info-icon-wrapper">
                          <span className="port-icon">#</span>
                        </div>
                        <div className="info-content">
                          <span className="info-label">Port</span>
                          <span className="info-value">{state.port}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Pairing Code */}
                  <div className="section">
                    <h3 className="section-title">Pairing Code</h3>
                    <p className="section-desc">Enter this code in the Atlas mobile app to connect</p>
                    
                    <div className="pairing-code-box">
                      <div className="pairing-code">
                        {state.pairingCode?.split('').map((digit, i) => (
                          <span key={i} className="code-digit">{digit}</span>
                        ))}
                      </div>
                      <div className="code-actions">
                        <button 
                          className="code-btn"
                          onClick={copyConnectionInfo}
                          title="Copy connection info"
                        >
                          {copied ? <CheckIcon className="btn-icon" /> : <CopyIcon className="btn-icon" />}
                          {copied ? 'Copied!' : 'Copy'}
                        </button>
                        <button 
                          className="code-btn"
                          onClick={regeneratePairingCode}
                          title="Generate new code"
                        >
                          <RefreshIcon className="btn-icon" />
                          Regenerate
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Connected Devices */}
                  <div className="section">
                    <h3 className="section-title">Connected Devices</h3>
                    
                    {state.connectedDevices.length === 0 ? (
                      <div className="no-devices">
                        <SmartphoneIcon className="empty-icon" />
                        <p>No devices connected</p>
                        <span>Pair a device using the code above</span>
                      </div>
                    ) : (
                      <div className="device-list">
                        {state.connectedDevices.map(device => (
                          <div key={device.id} className="device-item">
                            <SmartphoneIcon className="device-icon" />
                            <div className="device-info">
                              <span className="device-name">{device.name}</span>
                              <span className="device-last-seen">
                                Last seen: {formatLastSeen(device.lastSeen)}
                              </span>
                            </div>
                            <button 
                              className="disconnect-btn"
                              onClick={() => disconnectDevice(device.id)}
                              title="Disconnect device"
                            >
                              <TrashIcon className="btn-icon" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Instructions */}
                  <div className="section">
                    <h3 className="section-title">How to Connect</h3>
                    <ol className="instructions">
                      <li>Download the Atlas companion app on your mobile device</li>
                      <li>Ensure your phone is on the same network as this computer</li>
                      <li>Open the app and tap "Connect to Desktop"</li>
                      <li>Enter the IP address, port, and pairing code</li>
                      <li>Start controlling Atlas from your phone!</li>
                    </ol>
                  </div>
                </>
              )}

              {!state.enabled && (
                <div className="disabled-info">
                  <WifiIcon className="disabled-icon" />
                  <h3>Start the Server</h3>
                  <p>
                    Enable the mobile API server to control Atlas from your phone.
                    Make sure your mobile device is on the same network.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default MobileCompanion;
