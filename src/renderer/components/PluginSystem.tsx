/**
 * Atlas Desktop - Plugin System Component
 * Manage user-installable plugins to extend Atlas functionality
 */

import { useState, useEffect, useCallback } from 'react';
import './PluginSystem.css';

interface PluginSystemProps {
  isVisible: boolean;
  onClose: () => void;
}

interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  category: 'productivity' | 'automation' | 'integrations' | 'utilities' | 'fun';
  icon: string;
  installed: boolean;
  enabled: boolean;
  official: boolean;
  downloads: number;
  rating: number;
  permissions: string[];
}

const MOCK_PLUGINS: Plugin[] = [
  {
    id: 'spotify-enhanced',
    name: 'Spotify Enhanced',
    description: 'Advanced Spotify controls with queue management, playlist creation, and music recommendations',
    version: '2.1.0',
    author: 'Atlas Team',
    category: 'integrations',
    icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm3.5 14.5c-.28.4-.82.52-1.22.25-3.34-2.04-7.55-2.5-12.52-1.37-.48.11-.97-.19-1.08-.67-.11-.48.19-.97.67-1.08 5.44-1.24 10.11-.7 13.87 1.58.41.25.53.79.28 1.29z',
    installed: true,
    enabled: true,
    official: true,
    downloads: 12500,
    rating: 4.8,
    permissions: ['audio', 'network'],
  },
  {
    id: 'smart-home',
    name: 'Smart Home Hub',
    description: 'Control your smart home devices with voice commands. Supports Philips Hue, LIFX, Nest, and more',
    version: '1.5.2',
    author: 'Atlas Team',
    category: 'automation',
    icon: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
    installed: true,
    enabled: true,
    official: true,
    downloads: 8700,
    rating: 4.6,
    permissions: ['network', 'location'],
  },
  {
    id: 'code-runner',
    name: 'Code Runner',
    description: 'Execute code snippets in multiple languages directly through voice commands',
    version: '1.2.0',
    author: 'DevTools Community',
    category: 'productivity',
    icon: 'M8 5v14l11-7z',
    installed: false,
    enabled: false,
    official: false,
    downloads: 3200,
    rating: 4.4,
    permissions: ['filesystem', 'shell'],
  },
  {
    id: 'email-assistant',
    name: 'Email Assistant',
    description: 'Compose, read, and manage emails with intelligent suggestions and templates',
    version: '3.0.1',
    author: 'Atlas Team',
    category: 'productivity',
    icon: 'M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z',
    installed: true,
    enabled: false,
    official: true,
    downloads: 15600,
    rating: 4.7,
    permissions: ['network'],
  },
  {
    id: 'meeting-scheduler',
    name: 'Meeting Scheduler',
    description: 'Schedule meetings, send invites, and manage your calendar with natural language',
    version: '2.0.0',
    author: 'Calendar Pro',
    category: 'productivity',
    icon: 'M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z',
    installed: false,
    enabled: false,
    official: false,
    downloads: 5400,
    rating: 4.5,
    permissions: ['calendar', 'network'],
  },
  {
    id: 'joke-bot',
    name: 'Joke Bot',
    description: 'Get random jokes, puns, and fun facts on demand',
    version: '1.0.0',
    author: 'FunFactory',
    category: 'fun',
    icon: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM8.5 8c.83 0 1.5.67 1.5 1.5S9.33 11 8.5 11 7 10.33 7 9.5 7.67 8 8.5 8zM12 18c-2.28 0-4.22-1.66-5-4h10c-.78 2.34-2.72 4-5 4zm3.5-7c-.83 0-1.5-.67-1.5-1.5S14.67 8 15.5 8s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
    installed: false,
    enabled: false,
    official: false,
    downloads: 2100,
    rating: 4.2,
    permissions: [],
  },
  {
    id: 'clipboard-manager',
    name: 'Clipboard Manager',
    description: 'Advanced clipboard history with search, pinning, and smart paste',
    version: '1.8.0',
    author: 'Productivity Tools',
    category: 'utilities',
    icon: 'M19 2h-4.18C14.4.84 13.3 0 12 0c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm7 18H5V4h2v3h10V4h2v16z',
    installed: false,
    enabled: false,
    official: false,
    downloads: 4300,
    rating: 4.6,
    permissions: ['clipboard'],
  },
  {
    id: 'window-snapper',
    name: 'Window Snapper',
    description: 'Snap and organize windows with voice commands and custom layouts',
    version: '2.2.0',
    author: 'Atlas Team',
    category: 'utilities',
    icon: 'M4 4h7V2H4c-1.1 0-2 .9-2 2v7h2V4zm6 9l-4 5h3v4h2v-4h3l-4-5zm10-9h-7v2h7v7h2V4c0-1.1-.9-2-2-2zm0 16h-7v2h7c1.1 0 2-.9 2-2v-7h-2v7z',
    installed: true,
    enabled: true,
    official: true,
    downloads: 7800,
    rating: 4.9,
    permissions: ['windows'],
  },
];

const CATEGORIES = [
  { id: 'all', name: 'All', icon: 'M4 6h16M4 12h16M4 18h16' },
  { id: 'productivity', name: 'Productivity', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { id: 'automation', name: 'Automation', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
  { id: 'integrations', name: 'Integrations', icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' },
  { id: 'utilities', name: 'Utilities', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35' },
  { id: 'fun', name: 'Fun', icon: 'M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
];

export function PluginSystem({ isVisible, onClose }: PluginSystemProps) {
  const [plugins, setPlugins] = useState<Plugin[]>(MOCK_PLUGINS);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlugin, setSelectedPlugin] = useState<Plugin | null>(null);
  const [activeTab, setActiveTab] = useState<'browse' | 'installed'>('browse');

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isVisible) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedPlugin) {
          setSelectedPlugin(null);
        } else {
          handleClose();
        }
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isVisible, handleClose, selectedPlugin]);

  const filteredPlugins = plugins.filter(plugin => {
    const matchesCategory = selectedCategory === 'all' || plugin.category === selectedCategory;
    const matchesSearch = plugin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         plugin.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTab = activeTab === 'browse' || plugin.installed;
    return matchesCategory && matchesSearch && matchesTab;
  });

  const togglePluginEnabled = (pluginId: string) => {
    setPlugins(prev => prev.map(p =>
      p.id === pluginId ? { ...p, enabled: !p.enabled } : p
    ));
    if (selectedPlugin?.id === pluginId) {
      setSelectedPlugin(prev => prev ? { ...prev, enabled: !prev.enabled } : null);
    }
  };

  const installPlugin = (pluginId: string) => {
    setPlugins(prev => prev.map(p =>
      p.id === pluginId ? { ...p, installed: true, enabled: true } : p
    ));
    if (selectedPlugin?.id === pluginId) {
      setSelectedPlugin(prev => prev ? { ...prev, installed: true, enabled: true } : null);
    }
  };

  const uninstallPlugin = (pluginId: string) => {
    setPlugins(prev => prev.map(p =>
      p.id === pluginId ? { ...p, installed: false, enabled: false } : p
    ));
    if (selectedPlugin?.id === pluginId) {
      setSelectedPlugin(prev => prev ? { ...prev, installed: false, enabled: false } : null);
    }
  };

  const formatDownloads = (num: number) => {
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toString();
  };

  if (!isVisible) return null;

  return (
    <div className="plugin-overlay" onClick={handleClose}>
      <div className="plugin-container" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="ps-header">
          <div className="ps-title-row">
            <svg className="ps-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            <h2>Plugin Manager</h2>
          </div>
          <button className="ps-close" onClick={handleClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="ps-tabs">
          <button
            className={`ps-tab ${activeTab === 'browse' ? 'active' : ''}`}
            onClick={() => setActiveTab('browse')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            Browse
          </button>
          <button
            className={`ps-tab ${activeTab === 'installed' ? 'active' : ''}`}
            onClick={() => setActiveTab('installed')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Installed ({plugins.filter(p => p.installed).length})
          </button>
        </div>

        {/* Search and Filter */}
        <div className="ps-controls">
          <div className="ps-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search plugins..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="ps-categories">
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                className={`ps-category ${selectedCategory === cat.id ? 'active' : ''}`}
                onClick={() => setSelectedCategory(cat.id)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d={cat.icon} />
                </svg>
                <span>{cat.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="ps-content">
          <div className="ps-plugin-list">
            {filteredPlugins.length === 0 ? (
              <div className="ps-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
                <p>No plugins found</p>
                <span>Try adjusting your search or filters</span>
              </div>
            ) : (
              filteredPlugins.map(plugin => (
                <div
                  key={plugin.id}
                  className={`ps-plugin-card ${selectedPlugin?.id === plugin.id ? 'selected' : ''}`}
                  onClick={() => setSelectedPlugin(plugin)}
                >
                  <div className="ps-plugin-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d={plugin.icon} />
                    </svg>
                  </div>
                  <div className="ps-plugin-info">
                    <div className="ps-plugin-name">
                      {plugin.name}
                      {plugin.official && (
                        <span className="ps-official-badge">Official</span>
                      )}
                    </div>
                    <p className="ps-plugin-desc">{plugin.description}</p>
                    <div className="ps-plugin-meta">
                      <span className="ps-plugin-author">{plugin.author}</span>
                      <span className="ps-plugin-downloads">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        {formatDownloads(plugin.downloads)}
                      </span>
                      <span className="ps-plugin-rating">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                        {plugin.rating}
                      </span>
                    </div>
                  </div>
                  <div className="ps-plugin-status">
                    {plugin.installed ? (
                      <span className={`ps-status-badge ${plugin.enabled ? 'enabled' : 'disabled'}`}>
                        {plugin.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    ) : (
                      <span className="ps-status-badge available">Available</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Plugin Detail Panel */}
          {selectedPlugin && (
            <div className="ps-detail-panel">
              <div className="ps-detail-header">
                <div className="ps-detail-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d={selectedPlugin.icon} />
                  </svg>
                </div>
                <div className="ps-detail-title">
                  <h3>{selectedPlugin.name}</h3>
                  <span className="ps-detail-version">v{selectedPlugin.version}</span>
                </div>
                <button className="ps-detail-close" onClick={() => setSelectedPlugin(null)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="ps-detail-content">
                <p className="ps-detail-desc">{selectedPlugin.description}</p>

                <div className="ps-detail-stats">
                  <div className="ps-stat">
                    <span className="ps-stat-value">{formatDownloads(selectedPlugin.downloads)}</span>
                    <span className="ps-stat-label">Downloads</span>
                  </div>
                  <div className="ps-stat">
                    <span className="ps-stat-value">{selectedPlugin.rating}</span>
                    <span className="ps-stat-label">Rating</span>
                  </div>
                  <div className="ps-stat">
                    <span className="ps-stat-value">{selectedPlugin.author}</span>
                    <span className="ps-stat-label">Author</span>
                  </div>
                </div>

                {selectedPlugin.permissions.length > 0 && (
                  <div className="ps-permissions">
                    <h4>Permissions</h4>
                    <div className="ps-permission-list">
                      {selectedPlugin.permissions.map(perm => (
                        <span key={perm} className="ps-permission">{perm}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="ps-detail-actions">
                {selectedPlugin.installed ? (
                  <>
                    <button
                      className={`ps-action-btn ${selectedPlugin.enabled ? 'disable' : 'enable'}`}
                      onClick={() => togglePluginEnabled(selectedPlugin.id)}
                    >
                      {selectedPlugin.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      className="ps-action-btn uninstall"
                      onClick={() => uninstallPlugin(selectedPlugin.id)}
                    >
                      Uninstall
                    </button>
                  </>
                ) : (
                  <button
                    className="ps-action-btn install"
                    onClick={() => installPlugin(selectedPlugin.id)}
                  >
                    Install Plugin
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="ps-footer">
          <div className="ps-footer-info">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            <span>
              {plugins.filter(p => p.installed).length} plugins installed,{' '}
              {plugins.filter(p => p.installed && p.enabled).length} enabled
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
