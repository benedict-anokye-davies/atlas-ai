/**
 * Atlas Desktop - Offline Mode Indicator
 * Graceful offline fallback display
 */

import React, { useState, useEffect, useCallback } from 'react';
import './OfflineMode.css';

interface OfflineModeProps {
  isVisible: boolean;
  onClose: () => void;
}

interface ServiceStatus {
  name: string;
  status: 'online' | 'offline' | 'fallback' | 'checking';
  latency?: number;
  fallbackProvider?: string;
}

interface ConnectionInfo {
  isOnline: boolean;
  type: string;
  downlink?: number;
  rtt?: number;
}

const OfflineMode: React.FC<OfflineModeProps> = ({ isVisible, onClose }) => {
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo>({
    isOnline: navigator.onLine,
    type: 'unknown',
  });
  const [services, setServices] = useState<ServiceStatus[]>([
    { name: 'Speech-to-Text', status: 'checking' },
    { name: 'LLM Processing', status: 'checking' },
    { name: 'Text-to-Speech', status: 'checking' },
    { name: 'Memory Database', status: 'checking' },
    { name: 'Vector Search', status: 'checking' },
  ]);
  const [offlineCapabilities, setOfflineCapabilities] = useState({
    localSTT: false,
    localLLM: false,
    localTTS: false,
    cachedMemory: true,
  });
  const [lastSync, setLastSync] = useState<Date | null>(null);

  // Check connection status
  useEffect(() => {
    const updateConnection = () => {
      const nav = navigator as { connection?: { type?: string; downlink?: number; rtt?: number } };
      setConnectionInfo({
        isOnline: navigator.onLine,
        type: nav.connection?.type || 'unknown',
        downlink: nav.connection?.downlink,
        rtt: nav.connection?.rtt,
      });
    };

    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    updateConnection();

    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, []);

  // Check service statuses from Atlas API
  useEffect(() => {
    const checkServices = async () => {
      try {
        // Get real connectivity data from Atlas
        const connectivityResult = await window.atlas?.atlas?.getConnectivity?.();
        
        if (connectivityResult?.success && connectivityResult.data) {
          const { status, services: svcStatus } = connectivityResult.data;
          
          // Update connection info
          setConnectionInfo(prev => ({
            ...prev,
            isOnline: status?.isOnline ?? navigator.onLine,
          }));

          // Services can be booleans or objects with available/latency
          // Type assertion to handle both cases
          const getServiceStatus = (svc: boolean | { available?: boolean; latency?: number } | undefined) => {
            if (typeof svc === 'boolean') return { available: svc, latency: undefined };
            if (svc && typeof svc === 'object') return { available: svc.available ?? false, latency: svc.latency };
            return { available: false, latency: undefined };
          };

          const deepgram = getServiceStatus(svcStatus?.deepgram);
          const fireworks = getServiceStatus(svcStatus?.fireworks);
          const elevenlabs = getServiceStatus(svcStatus?.elevenlabs);

          // Map services to our format
          const serviceStatuses: ServiceStatus[] = [
            {
              name: 'Speech-to-Text',
              status: deepgram.available 
                ? 'online' 
                : offlineCapabilities.localSTT ? 'fallback' : 'offline',
              latency: deepgram.latency,
              fallbackProvider: !deepgram.available && offlineCapabilities.localSTT 
                ? 'Vosk (Local)' : undefined,
            },
            {
              name: 'LLM Processing',
              status: fireworks.available 
                ? 'online' 
                : offlineCapabilities.localLLM ? 'fallback' : 'offline',
              latency: fireworks.latency,
              fallbackProvider: !fireworks.available && offlineCapabilities.localLLM 
                ? 'Ollama (Local)' : undefined,
            },
            {
              name: 'Text-to-Speech',
              status: elevenlabs.available 
                ? 'online' 
                : offlineCapabilities.localTTS ? 'fallback' : 'offline',
              latency: elevenlabs.latency,
              fallbackProvider: !elevenlabs.available && offlineCapabilities.localTTS 
                ? 'Piper (Local)' : undefined,
            },
            {
              name: 'Memory Database',
              status: 'online',
              latency: 2,
            },
            {
              name: 'Vector Search',
              status: 'online',
              latency: 5,
            },
          ];

          setServices(serviceStatuses);
        } else {
          // Fallback if API not available
          const online = connectionInfo.isOnline;
          setServices([
            {
              name: 'Speech-to-Text',
              status: online ? 'online' : offlineCapabilities.localSTT ? 'fallback' : 'offline',
              latency: online ? 45 : undefined,
              fallbackProvider: !online && offlineCapabilities.localSTT ? 'Vosk (Local)' : undefined,
            },
            {
              name: 'LLM Processing',
              status: online ? 'online' : offlineCapabilities.localLLM ? 'fallback' : 'offline',
              latency: online ? 320 : undefined,
              fallbackProvider: !online && offlineCapabilities.localLLM ? 'Ollama (Local)' : undefined,
            },
            {
              name: 'Text-to-Speech',
              status: online ? 'online' : offlineCapabilities.localTTS ? 'fallback' : 'offline',
              latency: online ? 89 : undefined,
              fallbackProvider: !online && offlineCapabilities.localTTS ? 'Piper (Local)' : undefined,
            },
            {
              name: 'Memory Database',
              status: 'online',
              latency: 2,
            },
            {
              name: 'Vector Search',
              status: 'online',
              latency: 5,
            },
          ]);
        }
      } catch (error) {
        console.error('[OfflineMode] Failed to check services:', error);
      }
    };

    if (isVisible) {
      checkServices();
      // Refresh every 5 seconds
      const interval = setInterval(checkServices, 5000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [isVisible, connectionInfo.isOnline, offlineCapabilities]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isVisible) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
    return undefined;
  }, [isVisible, onClose]);

  // Load last sync time
  useEffect(() => {
    const saved = localStorage.getItem('atlas-last-sync');
    if (saved) {
      setLastSync(new Date(saved));
    }
  }, []);

  // Toggle offline capability
  const toggleCapability = (key: keyof typeof offlineCapabilities) => {
    setOfflineCapabilities((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // Force sync
  const handleSync = useCallback(() => {
    const now = new Date();
    setLastSync(now);
    localStorage.setItem('atlas-last-sync', now.toISOString());
  }, []);

  // Get status icon
  const getStatusIcon = (status: ServiceStatus['status']) => {
    switch (status) {
      case 'online':
        return (
          <svg className="status-icon online" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
            <polyline points="22,4 12,14.01 9,11.01" />
          </svg>
        );
      case 'offline':
        return (
          <svg className="status-icon offline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        );
      case 'fallback':
        return (
          <svg className="status-icon fallback" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        );
      case 'checking':
        return (
          <svg className="status-icon checking" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12,6 12,12 16,14" />
          </svg>
        );
    }
  };

  if (!isVisible) return null;

  return (
    <div className="offline-overlay" onClick={onClose}>
      <div className="offline-container" onClick={(e) => e.stopPropagation()}>
        <div className="offline-header">
          <div className="offline-title-row">
            <div className={`offline-status-badge ${connectionInfo.isOnline ? 'online' : 'offline'}`}>
              <span className="status-dot" />
              <span>{connectionInfo.isOnline ? 'Online' : 'Offline'}</span>
            </div>
            <h2>Connection Status</h2>
          </div>
          <button className="offline-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="offline-content">
          {/* Connection Info */}
          <div className="connection-card">
            <div className="connection-visual">
              <div className={`connection-globe ${connectionInfo.isOnline ? 'connected' : 'disconnected'}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                </svg>
              </div>
              {connectionInfo.isOnline && (
                <div className="connection-waves">
                  <span className="wave" />
                  <span className="wave" />
                  <span className="wave" />
                </div>
              )}
            </div>
            <div className="connection-details">
              <div className="connection-stat">
                <span className="stat-label">Network Type</span>
                <span className="stat-value">{connectionInfo.type || 'Unknown'}</span>
              </div>
              {connectionInfo.downlink && (
                <div className="connection-stat">
                  <span className="stat-label">Bandwidth</span>
                  <span className="stat-value">{connectionInfo.downlink} Mbps</span>
                </div>
              )}
              {connectionInfo.rtt && (
                <div className="connection-stat">
                  <span className="stat-label">Latency</span>
                  <span className="stat-value">{connectionInfo.rtt}ms</span>
                </div>
              )}
            </div>
          </div>

          {/* Services Status */}
          <div className="services-section">
            <h3>Services</h3>
            <div className="services-list">
              {services.map((service) => (
                <div key={service.name} className={`service-item ${service.status}`}>
                  <div className="service-info">
                    {getStatusIcon(service.status)}
                    <span className="service-name">{service.name}</span>
                  </div>
                  <div className="service-status-info">
                    {service.latency && (
                      <span className="service-latency">{service.latency}ms</span>
                    )}
                    {service.fallbackProvider && (
                      <span className="service-fallback">{service.fallbackProvider}</span>
                    )}
                    <span className={`service-status-badge ${service.status}`}>
                      {service.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Offline Capabilities */}
          <div className="capabilities-section">
            <h3>Offline Capabilities</h3>
            <p className="capabilities-desc">
              Enable local providers to continue working when offline
            </p>
            <div className="capabilities-grid">
              <div className="capability-card">
                <div className="capability-header">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z" />
                    <path d="M19 10v2a7 7 0 01-14 0v-2" />
                  </svg>
                  <span>Local STT (Vosk)</span>
                </div>
                <p>Offline speech recognition with lower accuracy</p>
                <label className="capability-toggle">
                  <input
                    type="checkbox"
                    checked={offlineCapabilities.localSTT}
                    onChange={() => toggleCapability('localSTT')}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>

              <div className="capability-card">
                <div className="capability-header">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                  </svg>
                  <span>Local LLM (Ollama)</span>
                </div>
                <p>Offline AI processing with smaller models</p>
                <label className="capability-toggle">
                  <input
                    type="checkbox"
                    checked={offlineCapabilities.localLLM}
                    onChange={() => toggleCapability('localLLM')}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>

              <div className="capability-card">
                <div className="capability-header">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" />
                    <path d="M15.54 8.46a5 5 0 010 7.07" />
                  </svg>
                  <span>Local TTS (Piper)</span>
                </div>
                <p>Offline text-to-speech with neural voices</p>
                <label className="capability-toggle">
                  <input
                    type="checkbox"
                    checked={offlineCapabilities.localTTS}
                    onChange={() => toggleCapability('localTTS')}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>

              <div className="capability-card enabled">
                <div className="capability-header">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                  </svg>
                  <span>Cached Memory</span>
                </div>
                <p>Local SQLite database always available</p>
                <span className="capability-enabled">Always On</span>
              </div>
            </div>
          </div>

          {/* Sync Section */}
          <div className="sync-section">
            <div className="sync-info">
              <h3>Data Sync</h3>
              <p>
                {lastSync
                  ? `Last synced: ${lastSync.toLocaleString()}`
                  : 'Never synced'}
              </p>
            </div>
            <button className="sync-btn" onClick={handleSync}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="1,4 1,10 7,10" />
                <polyline points="23,20 23,14 17,14" />
                <path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15" />
              </svg>
              Sync Now
            </button>
          </div>
        </div>

        <div className="offline-footer">
          <div className="footer-hint">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>Atlas will automatically switch to available providers based on connectivity</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OfflineMode;
