/**
 * ModelSelector Component
 * 
 * UI component for selecting and managing local LLM models.
 * Allows users to switch models, download new ones, and view
 * model information.
 */

import React, { useState, useEffect, useCallback } from 'react';
import './ModelSelector.css';

// ============================================================================
// Types
// ============================================================================

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  sizeHuman: string;
  parameterCount?: string;
  contextLength: number;
  capabilities: string[];
  isInstalled: boolean;
  isDefault: boolean;
  downloadProgress?: number;
  performance?: {
    tokensPerSecond: number;
    lastUsed?: string;
  };
}

interface ModelSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onModelChange?: (modelId: string) => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getCapabilityIcon(capability: string): string {
  const icons: Record<string, string> = {
    chat: '💬',
    completion: '✏️',
    code: '💻',
    vision: '👁️',
    embedding: '🔗',
    'function-calling': '⚙️',
  };
  return icons[capability] || '✨';
}

function formatCapability(capability: string): string {
  return capability.split('-').map(w => 
    w.charAt(0).toUpperCase() + w.slice(1)
  ).join(' ');
}

// ============================================================================
// Sub-Components
// ============================================================================

const ModelCard: React.FC<{
  model: ModelInfo;
  isDownloading: boolean;
  downloadProgress?: number;
  onSelect: () => void;
  onDownload: () => void;
  onDelete: () => void;
}> = ({ model, isDownloading, downloadProgress, onSelect, onDownload, onDelete }) => {
  const [showDetails, setShowDetails] = useState(false);
  
  return (
    <div 
      className={`model-card ${model.isDefault ? 'model-card-default' : ''} ${model.isInstalled ? 'model-card-installed' : ''}`}
    >
      <div className="model-card-header">
        <div className="model-info">
          <h4 className="model-name">
            {model.name}
            {model.isDefault && <span className="default-badge">Default</span>}
          </h4>
          <div className="model-meta">
            <span className="model-size">{model.sizeHuman}</span>
            {model.parameterCount && (
              <span className="model-params">{model.parameterCount}</span>
            )}
            <span className="model-context">{model.contextLength.toLocaleString()} ctx</span>
          </div>
        </div>
        
        <div className="model-actions">
          {model.isInstalled ? (
            <>
              {!model.isDefault && (
                <button 
                  className="model-btn model-btn-primary"
                  onClick={onSelect}
                  title="Set as default"
                >
                  Use
                </button>
              )}
              <button 
                className="model-btn model-btn-icon"
                onClick={() => setShowDetails(!showDetails)}
                title="Show details"
              >
                ℹ️
              </button>
              {!model.isDefault && (
                <button 
                  className="model-btn model-btn-danger"
                  onClick={onDelete}
                  title="Delete model"
                >
                  🗑️
                </button>
              )}
            </>
          ) : (
            <button 
              className="model-btn model-btn-download"
              onClick={onDownload}
              disabled={isDownloading}
            >
              {isDownloading ? `${Math.round(downloadProgress || 0)}%` : 'Download'}
            </button>
          )}
        </div>
      </div>
      
      {/* Download Progress */}
      {isDownloading && (
        <div className="download-progress">
          <div 
            className="download-progress-bar"
            style={{ width: `${downloadProgress || 0}%` }}
          />
        </div>
      )}
      
      {/* Capabilities */}
      <div className="model-capabilities">
        {model.capabilities.map(cap => (
          <span key={cap} className="capability-badge" title={formatCapability(cap)}>
            {getCapabilityIcon(cap)} {formatCapability(cap)}
          </span>
        ))}
      </div>
      
      {/* Expanded Details */}
      {showDetails && model.isInstalled && (
        <div className="model-details">
          <div className="detail-row">
            <span className="detail-label">Provider</span>
            <span className="detail-value">{model.provider}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Model ID</span>
            <span className="detail-value code">{model.id}</span>
          </div>
          {model.performance && (
            <>
              <div className="detail-row">
                <span className="detail-label">Speed</span>
                <span className="detail-value">
                  {model.performance.tokensPerSecond.toFixed(1)} tokens/sec
                </span>
              </div>
              {model.performance.lastUsed && (
                <div className="detail-row">
                  <span className="detail-label">Last Used</span>
                  <span className="detail-value">
                    {new Date(model.performance.lastUsed).toLocaleDateString()}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

const StatusBanner: React.FC<{
  isOllamaAvailable: boolean;
  onRefresh: () => void;
}> = ({ isOllamaAvailable, onRefresh }) => (
  <div className={`status-banner ${isOllamaAvailable ? 'status-connected' : 'status-disconnected'}`}>
    <span className="status-indicator" />
    <span className="status-text">
      {isOllamaAvailable ? 'Ollama Connected' : 'Ollama Not Running'}
    </span>
    <button className="status-refresh" onClick={onRefresh} title="Refresh">
      🔄
    </button>
    {!isOllamaAvailable && (
      <a 
        href="https://ollama.ai" 
        target="_blank" 
        rel="noopener noreferrer"
        className="status-link"
      >
        Get Ollama
      </a>
    )}
  </div>
);

// ============================================================================
// Main Component
// ============================================================================

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  isOpen,
  onClose,
  onModelChange,
}) => {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOllamaAvailable, setIsOllamaAvailable] = useState(false);
  const [activeDownloads, setActiveDownloads] = useState<Map<string, number>>(new Map());
  const [filter, setFilter] = useState<'all' | 'installed' | 'available'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchModels = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Access model manager API through dynamic window.atlas
      const atlasAny = window.atlas as unknown as Record<string, unknown>;
      
      if (atlasAny?.models && typeof atlasAny.models === 'object') {
        const modelsApi = atlasAny.models as {
          getAvailable?: () => Promise<{ success: boolean; data?: ModelInfo[] }>;
          isOllamaAvailable?: () => Promise<{ success: boolean; data?: boolean }>;
        };
        
        // Check Ollama availability
        if (modelsApi.isOllamaAvailable) {
          const availResult = await modelsApi.isOllamaAvailable();
          setIsOllamaAvailable(availResult.success && availResult.data === true);
        }
        
        // Get models
        if (modelsApi.getAvailable) {
          const result = await modelsApi.getAvailable();
          if (result.success && result.data) {
            setModels(result.data);
          }
        }
      } else {
        // Mock data for development
        setIsOllamaAvailable(true);
        setModels([
          {
            id: 'llama3.1:8b',
            name: 'Llama 3.1 8B',
            provider: 'ollama',
            sizeHuman: '4.7 GB',
            parameterCount: '8B',
            contextLength: 8192,
            capabilities: ['chat', 'completion', 'code'],
            isInstalled: true,
            isDefault: true,
            performance: { tokensPerSecond: 45.2 },
          },
          {
            id: 'codellama:7b',
            name: 'Code Llama 7B',
            provider: 'ollama',
            sizeHuman: '3.8 GB',
            parameterCount: '7B',
            contextLength: 16384,
            capabilities: ['completion', 'code'],
            isInstalled: true,
            isDefault: false,
            performance: { tokensPerSecond: 52.1 },
          },
          {
            id: 'phi3:mini',
            name: 'Phi-3 Mini',
            provider: 'ollama',
            sizeHuman: '2.3 GB',
            parameterCount: '3.8B',
            contextLength: 4096,
            capabilities: ['chat', 'completion'],
            isInstalled: false,
            isDefault: false,
          },
          {
            id: 'mistral:7b',
            name: 'Mistral 7B',
            provider: 'ollama',
            sizeHuman: '4.1 GB',
            parameterCount: '7B',
            contextLength: 8192,
            capabilities: ['chat', 'completion', 'code'],
            isInstalled: false,
            isDefault: false,
          },
          {
            id: 'llava:7b',
            name: 'LLaVA 7B (Vision)',
            provider: 'ollama',
            sizeHuman: '4.5 GB',
            parameterCount: '7B',
            contextLength: 4096,
            capabilities: ['chat', 'vision'],
            isInstalled: false,
            isDefault: false,
          },
        ]);
      }
      
      setIsLoading(false);
    } catch (err) {
      setError('Failed to load models');
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchModels();
    }
  }, [isOpen, fetchModels]);

  const handleSelectModel = async (modelId: string) => {
    const atlasAny = window.atlas as unknown as Record<string, unknown>;
    
    if (atlasAny?.models && typeof atlasAny.models === 'object') {
      const modelsApi = atlasAny.models as {
        setDefault?: (id: string) => Promise<{ success: boolean }>;
      };
      
      if (modelsApi.setDefault) {
        await modelsApi.setDefault(modelId);
      }
    }
    
    // Update local state
    setModels(models.map(m => ({
      ...m,
      isDefault: m.id === modelId,
    })));
    
    onModelChange?.(modelId);
  };

  const handleDownloadModel = async (modelId: string) => {
    setActiveDownloads(prev => new Map(prev).set(modelId, 0));
    
    const atlasAny = window.atlas as unknown as Record<string, unknown>;
    
    if (atlasAny?.models && typeof atlasAny.models === 'object') {
      const modelsApi = atlasAny.models as {
        download?: (id: string, onProgress: (p: number) => void) => Promise<{ success: boolean }>;
      };
      
      if (modelsApi.download) {
        await modelsApi.download(modelId, (progress) => {
          setActiveDownloads(prev => new Map(prev).set(modelId, progress));
        });
      }
    } else {
      // Simulate download for demo
      for (let i = 0; i <= 100; i += 10) {
        await new Promise(resolve => setTimeout(resolve, 300));
        setActiveDownloads(prev => new Map(prev).set(modelId, i));
      }
    }
    
    setActiveDownloads(prev => {
      const next = new Map(prev);
      next.delete(modelId);
      return next;
    });
    
    // Refresh models list
    fetchModels();
  };

  const handleDeleteModel = async (modelId: string) => {
    if (!confirm(`Delete model "${modelId}"? This cannot be undone.`)) {
      return;
    }
    
    const atlasAny = window.atlas as unknown as Record<string, unknown>;
    
    if (atlasAny?.models && typeof atlasAny.models === 'object') {
      const modelsApi = atlasAny.models as {
        delete?: (id: string) => Promise<{ success: boolean }>;
      };
      
      if (modelsApi.delete) {
        await modelsApi.delete(modelId);
      }
    }
    
    fetchModels();
  };

  // Filter models
  const filteredModels = models.filter(model => {
    // Filter by status
    if (filter === 'installed' && !model.isInstalled) return false;
    if (filter === 'available' && model.isInstalled) return false;
    
    // Filter by search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        model.name.toLowerCase().includes(query) ||
        model.id.toLowerCase().includes(query) ||
        model.capabilities.some(c => c.toLowerCase().includes(query))
      );
    }
    
    return true;
  });

  if (!isOpen) return null;

  return (
    <div className="model-selector-overlay" onClick={onClose}>
      <div className="model-selector" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="model-selector-header">
          <h2>Local Models</h2>
          <button className="model-selector-close" onClick={onClose}>×</button>
        </div>

        {/* Status Banner */}
        <StatusBanner 
          isOllamaAvailable={isOllamaAvailable} 
          onRefresh={fetchModels}
        />

        {/* Filters */}
        <div className="model-filters">
          <div className="filter-tabs">
            <button 
              className={`filter-tab ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All ({models.length})
            </button>
            <button 
              className={`filter-tab ${filter === 'installed' ? 'active' : ''}`}
              onClick={() => setFilter('installed')}
            >
              Installed ({models.filter(m => m.isInstalled).length})
            </button>
            <button 
              className={`filter-tab ${filter === 'available' ? 'active' : ''}`}
              onClick={() => setFilter('available')}
            >
              Available ({models.filter(m => !m.isInstalled).length})
            </button>
          </div>
          
          <input
            type="text"
            className="model-search"
            placeholder="Search models..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Content */}
        <div className="model-selector-content">
          {isLoading && (
            <div className="model-loading">
              <div className="spinner"></div>
              <span>Loading models...</span>
            </div>
          )}

          {error && (
            <div className="model-error">
              <span>⚠️ {error}</span>
              <button onClick={fetchModels}>Retry</button>
            </div>
          )}

          {!isLoading && !error && (
            <div className="model-list">
              {filteredModels.length === 0 ? (
                <div className="no-models">
                  <span>No models found</span>
                </div>
              ) : (
                filteredModels.map(model => (
                  <ModelCard
                    key={model.id}
                    model={model}
                    isDownloading={activeDownloads.has(model.id)}
                    downloadProgress={activeDownloads.get(model.id)}
                    onSelect={() => handleSelectModel(model.id)}
                    onDownload={() => handleDownloadModel(model.id)}
                    onDelete={() => handleDeleteModel(model.id)}
                  />
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="model-selector-footer">
          <span className="footer-hint">
            💡 Smaller models are faster but less capable. Start with Llama 3.1 8B for general use.
          </span>
        </div>
      </div>
    </div>
  );
};

export default ModelSelector;
