/**
 * Atlas Desktop - Palantir Dashboard Demo Page
 * Demo integration of all palantir components
 */
import React, { useState, useCallback } from 'react';
import '../styles/palantir-theme.css';
import {
  AppShell,
  Header,
  LeftNav,
  StatusBar,
  Dashboard,
  ViewId,
} from '../components/palantir';

// Types imported from atlas.d.ts

/**
 * Main Demo Page showing the complete Palantir-style UI
 */
export const PalantirDemo: React.FC = () => {
  const [activeView, setActiveView] = useState<ViewId>('dashboard');
  const [isNavExpanded] = useState(false);
  const [isContextPanelOpen, setIsContextPanelOpen] = useState(false);

  const handleViewChange = useCallback((view: ViewId) => {
    setActiveView(view);
  }, []);

  const handleSettingsClick = useCallback(() => {
    console.log('Open settings');
    // TODO: Open settings modal/panel
  }, []);

  const renderMainContent = () => {
    switch (activeView) {
      case 'dashboard':
        return <Dashboard />;
      case 'trading':
        return (
          <div className="placeholder-view">
            <h2>Trading View</h2>
            <p>Trading interface coming soon...</p>
          </div>
        );
      case 'banking':
        return (
          <div className="placeholder-view">
            <h2>Banking View</h2>
            <p>Banking interface coming soon...</p>
          </div>
        );
      case 'intelligence':
        return (
          <div className="placeholder-view">
            <h2>Intelligence View</h2>
            <p>Intelligence dashboard coming soon...</p>
          </div>
        );
      case 'projects':
        return (
          <div className="placeholder-view">
            <h2>Projects View</h2>
            <p>Projects interface coming soon...</p>
          </div>
        );
      default:
        return <Dashboard />;
    }
  };

  return (
    <AppShell
      header={<Header title="Atlas" subtitle={activeView} />}
      leftNav={
        <LeftNav
          activeView={activeView}
          isExpanded={isNavExpanded}
          onViewChange={handleViewChange}
          onSettingsClick={handleSettingsClick}
          items={[
            { 
              id: 'dashboard', 
              label: 'Dashboard', 
              icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M3 3h6v6H3V3zm0 8h6v6H3v-6zm8-8h6v6h-6V3zm0 8h6v6h-6v-6z"/></svg>
            },
            { 
              id: 'trading', 
              label: 'Trading', 
              icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M3 17V7l4 4 4-6 6 8v4H3z"/></svg>,
              badge: 3
            },
            { 
              id: 'banking', 
              label: 'Banking', 
              icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2L2 6v2h16V6l-8-4zM4 10v6h3v-6H4zm4.5 0v6h3v-6h-3zM13 10v6h3v-6h-3zM2 18h16v2H2v-2z"/></svg>
            },
            { 
              id: 'intelligence', 
              label: 'Intelligence', 
              icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12z"/></svg>
            },
            { 
              id: 'projects', 
              label: 'Projects', 
              icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M2 4a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4z"/></svg>
            },
          ]}
        />
      }
      statusBar={
        <StatusBar
          connectionStatus="online"
          voiceState="idle"
          llmProvider="Fireworks"
          cpuUsage={23}
          memoryUsage={45}
          fps={60}
        />
      }
      contextPanel={isContextPanelOpen ? (
        <div className="context-panel">
          <h3>Context Panel</h3>
          <p>Additional context and details will appear here.</p>
        </div>
      ) : undefined}
      showContextPanel={isContextPanelOpen}
      onContextPanelToggle={(show) => setIsContextPanelOpen(show)}
    >
      {renderMainContent()}
    </AppShell>
  );
};

export default PalantirDemo;
