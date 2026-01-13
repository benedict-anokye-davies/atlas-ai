/**
 * Nova Desktop - Main App Component
 */

import { useState, useEffect } from 'react';
import './styles/App.css';
import type { NovaStatus } from './types/nova';

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
