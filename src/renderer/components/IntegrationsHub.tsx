/**
 * Atlas Desktop - Integrations Hub
 * Manage third-party service connections
 */

import React, { useState, useEffect, useCallback } from 'react';
import './IntegrationsHub.css';

// ============================================================================
// Types
// ============================================================================

interface Integration {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'communication' | 'productivity' | 'media' | 'developer' | 'smart-home';
  connected: boolean;
  features: string[];
  setupUrl?: string;
}

interface IntegrationsHubProps {
  isVisible: boolean;
  onClose: () => void;
}

// ============================================================================
// Icons
// ============================================================================

const GridIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
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

const ExternalIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const SearchIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

// ============================================================================
// Constants
// ============================================================================

const INTEGRATIONS: Integration[] = [
  {
    id: 'spotify',
    name: 'Spotify',
    description: 'Control music playback, search songs, and manage playlists',
    icon: '🎵',
    category: 'media',
    connected: false,
    features: ['Play/pause/skip', 'Search music', 'Control volume', 'View queue'],
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Send messages, join voice channels, and manage servers',
    icon: '💬',
    category: 'communication',
    connected: false,
    features: ['Send messages', 'Join voice', 'Manage status', 'Read DMs'],
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Send messages, check notifications, and manage channels',
    icon: '📱',
    category: 'communication',
    connected: false,
    features: ['Send messages', 'Search workspace', 'Set status', 'Manage DND'],
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'View and create events, get reminders, and check availability',
    icon: '📅',
    category: 'productivity',
    connected: false,
    features: ['View events', 'Create events', 'Get reminders', 'Check free slots'],
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Read, send, and manage emails with voice commands',
    icon: '✉️',
    category: 'communication',
    connected: false,
    features: ['Read emails', 'Send emails', 'Search inbox', 'Manage labels'],
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Manage repositories, issues, and pull requests',
    icon: '🐙',
    category: 'developer',
    connected: false,
    features: ['View repos', 'Create issues', 'Check PRs', 'Clone repos'],
  },
  {
    id: 'vscode',
    name: 'VS Code',
    description: 'Control your editor, run commands, and manage files',
    icon: '💻',
    category: 'developer',
    connected: true,
    features: ['Open files', 'Run commands', 'Search code', 'Git operations'],
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Search and update your notes, databases, and wikis',
    icon: '📝',
    category: 'productivity',
    connected: false,
    features: ['Search pages', 'Create notes', 'Update databases', 'Quick capture'],
  },
  {
    id: 'todoist',
    name: 'Todoist',
    description: 'Manage tasks, projects, and reminders',
    icon: '✅',
    category: 'productivity',
    connected: false,
    features: ['Add tasks', 'Complete tasks', 'View today', 'Set reminders'],
  },
  {
    id: 'philips-hue',
    name: 'Philips Hue',
    description: 'Control smart lights, scenes, and automations',
    icon: '💡',
    category: 'smart-home',
    connected: false,
    features: ['Toggle lights', 'Set brightness', 'Change colors', 'Activate scenes'],
  },
  {
    id: 'home-assistant',
    name: 'Home Assistant',
    description: 'Control your smart home devices and automations',
    icon: '🏠',
    category: 'smart-home',
    connected: false,
    features: ['Control devices', 'Run automations', 'Check sensors', 'Voice commands'],
  },
  {
    id: 'youtube-music',
    name: 'YouTube Music',
    description: 'Play music, create playlists, and discover new songs',
    icon: '🎶',
    category: 'media',
    connected: false,
    features: ['Play music', 'Search songs', 'Control playback', 'Like songs'],
  },
];

const CATEGORIES = [
  { id: 'all', name: 'All' },
  { id: 'communication', name: 'Communication' },
  { id: 'productivity', name: 'Productivity' },
  { id: 'media', name: 'Media' },
  { id: 'developer', name: 'Developer' },
  { id: 'smart-home', name: 'Smart Home' },
];

// ============================================================================
// Main Component
// ============================================================================

export const IntegrationsHub: React.FC<IntegrationsHubProps> = ({ isVisible, onClose }) => {
  const [integrations, setIntegrations] = useState<Integration[]>(INTEGRATIONS);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Load integration status
  useEffect(() => {
    if (!isVisible) return;
    
    // Load from localStorage
    const stored = localStorage.getItem('atlas:integrations');
    if (stored) {
      const status = JSON.parse(stored) as Record<string, boolean>;
      setIntegrations(prev => prev.map(i => ({
        ...i,
        connected: status[i.id] || false,
      })));
    }
  }, [isVisible]);

  // Filter integrations
  const filteredIntegrations = integrations.filter(i => {
    if (selectedCategory !== 'all' && i.category !== selectedCategory) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        i.name.toLowerCase().includes(query) ||
        i.description.toLowerCase().includes(query)
      );
    }
    return true;
  });

  // Connect/disconnect integration
  const toggleConnection = useCallback(async (id: string) => {
    setConnecting(true);
    
    // Simulate connection
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    setIntegrations(prev => {
      const updated = prev.map(i =>
        i.id === id ? { ...i, connected: !i.connected } : i
      );
      
      // Save to localStorage
      const status: Record<string, boolean> = {};
      updated.forEach(i => { status[i.id] = i.connected; });
      localStorage.setItem('atlas:integrations', JSON.stringify(status));
      
      return updated;
    });
    
    setSelectedIntegration(prev => 
      prev?.id === id ? { ...prev, connected: !prev.connected } : prev
    );
    
    setConnecting(false);
  }, []);

  // Stats
  const connectedCount = integrations.filter(i => i.connected).length;

  if (!isVisible) return null;

  return (
    <div className="integrations-hub-overlay">
      <div className="integrations-hub-container">
        {/* Header */}
        <div className="ih-header">
          <div className="ih-title-row">
            <GridIcon className="ih-icon" />
            <h2>Integrations Hub</h2>
          </div>
          <button className="ih-close" onClick={onClose}>
            <XIcon />
          </button>
        </div>

        {/* Stats */}
        <div className="ih-stats">
          <div className="stat">
            <span className="stat-value">{connectedCount}</span>
            <span className="stat-label">Connected</span>
          </div>
          <div className="stat">
            <span className="stat-value">{integrations.length}</span>
            <span className="stat-label">Available</span>
          </div>
        </div>

        {/* Search & Filter */}
        <div className="ih-controls">
          <div className="search-box">
            <SearchIcon className="search-icon" />
            <input
              type="text"
              placeholder="Search integrations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="category-tabs">
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                className={`cat-btn ${selectedCategory === cat.id ? 'active' : ''}`}
                onClick={() => setSelectedCategory(cat.id)}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="ih-content">
          <div className="ih-grid">
            {filteredIntegrations.map(integration => (
              <div
                key={integration.id}
                className={`integration-card ${integration.connected ? 'connected' : ''}`}
                onClick={() => setSelectedIntegration(integration)}
              >
                <div className="card-header">
                  <span className="card-icon">{integration.icon}</span>
                  {integration.connected && (
                    <span className="connected-badge">
                      <CheckIcon /> Connected
                    </span>
                  )}
                </div>
                <h3>{integration.name}</h3>
                <p>{integration.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Detail Panel */}
        {selectedIntegration && (
          <div className="detail-panel">
            <div className="detail-header">
              <span className="detail-icon">{selectedIntegration.icon}</span>
              <div className="detail-info">
                <h3>{selectedIntegration.name}</h3>
                <span className={`detail-status ${selectedIntegration.connected ? 'connected' : ''}`}>
                  {selectedIntegration.connected ? 'Connected' : 'Not connected'}
                </span>
              </div>
              <button className="detail-close" onClick={() => setSelectedIntegration(null)}>
                <XIcon />
              </button>
            </div>

            <p className="detail-description">{selectedIntegration.description}</p>

            <div className="detail-features">
              <h4>Features</h4>
              <ul>
                {selectedIntegration.features.map((feature, i) => (
                  <li key={i}>
                    <CheckIcon className="feature-icon" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>

            <div className="detail-actions">
              <button
                className={`connect-btn ${selectedIntegration.connected ? 'disconnect' : ''}`}
                onClick={() => toggleConnection(selectedIntegration.id)}
                disabled={connecting}
              >
                {connecting ? 'Processing...' : selectedIntegration.connected ? 'Disconnect' : 'Connect'}
              </button>
              {selectedIntegration.setupUrl && (
                <a 
                  href={selectedIntegration.setupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="setup-link"
                >
                  <ExternalIcon /> Setup Guide
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default IntegrationsHub;
