/**
 * Nova Desktop - Main App Component
 */

import { useState, useEffect } from 'react';
import './styles/App.css';

// Nova status type
interface NovaStatus {
  status: string;
  version: string;
  isDev: boolean;
}

function App() {
  const [status, setStatus] = useState<NovaStatus | null>(null);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    // Get Nova status on mount
    const loadStatus = async () => {
      try {
        if (window.nova) {
          const novaStatus = await window.nova.getStatus();
          setStatus(novaStatus);
        }
      } catch (error) {
        console.error('[Nova] Failed to get status:', error);
      }
    };

    loadStatus();
  }, []);

  const handleOrbClick = () => {
    setListening(!listening);
    console.log('[Nova] Orb clicked, listening:', !listening);
  };

  return (
    <div className="nova-app">
      {/* Header */}
      <header className="nova-header">
        <h1 className="nova-title">Nova</h1>
        <span className="nova-version">
          {status?.version || '0.0.0'} {status?.isDev ? '(dev)' : ''}
        </span>
      </header>

      {/* Main content - Orb placeholder */}
      <main className="nova-main">
        <div 
          className={`nova-orb ${listening ? 'listening' : ''}`}
          onClick={handleOrbClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && handleOrbClick()}
        >
          <div className="orb-core" />
          <div className="orb-glow" />
        </div>
        
        <p className="nova-status">
          {listening ? 'Listening...' : 'Click the orb or say "Hey Nova"'}
        </p>
      </main>

      {/* Footer */}
      <footer className="nova-footer">
        <p>Status: {status?.status || 'Loading...'}</p>
      </footer>
    </div>
  );
}

export default App;

// Extend Window interface for Nova API
declare global {
  interface Window {
    nova?: {
      getVersion: () => Promise<string>;
      getAppPath: () => Promise<string>;
      isDev: () => Promise<boolean>;
      getStatus: () => Promise<NovaStatus>;
      platform: string;
      send: (channel: string, data?: unknown) => void;
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
      invoke: <T>(channel: string, ...args: unknown[]) => Promise<T>;
    };
  }
}
