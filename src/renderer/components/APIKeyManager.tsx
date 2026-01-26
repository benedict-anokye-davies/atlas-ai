/**
 * Atlas Desktop - API Key Manager
 * UI for managing API keys securely
 */

import React, { useState, useEffect, useCallback } from 'react';
import './APIKeyManager.css';

// ============================================================================
// Types
// ============================================================================

interface APIKeyConfig {
  id: string;
  name: string;
  service: string;
  description: string;
  required: boolean;
  configured: boolean;
  maskedValue?: string;
  docsUrl?: string;
}

interface APIKeyManagerProps {
  isVisible: boolean;
  onClose: () => void;
}

// ============================================================================
// Icons
// ============================================================================

const KeyIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
);

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const EyeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

const CheckIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const AlertIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const ExternalIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const TrashIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const ShieldIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

// ============================================================================
// Constants
// ============================================================================

const API_SERVICES: Omit<APIKeyConfig, 'configured' | 'maskedValue'>[] = [
  {
    id: 'porcupine',
    name: 'Porcupine API Key',
    service: 'Picovoice',
    description: 'Wake word detection for "Hey Atlas" activation',
    required: true,
    docsUrl: 'https://console.picovoice.ai/',
  },
  {
    id: 'deepgram',
    name: 'Deepgram API Key',
    service: 'Deepgram',
    description: 'Speech-to-text transcription with real-time streaming',
    required: true,
    docsUrl: 'https://console.deepgram.com/',
  },
  {
    id: 'fireworks',
    name: 'Fireworks API Key',
    service: 'Fireworks AI',
    description: 'LLM processing for natural language understanding',
    required: true,
    docsUrl: 'https://fireworks.ai/',
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs API Key',
    service: 'ElevenLabs',
    description: 'Text-to-speech synthesis with natural voices',
    required: true,
    docsUrl: 'https://elevenlabs.io/',
  },
  {
    id: 'openai',
    name: 'OpenAI API Key',
    service: 'OpenAI',
    description: 'Alternative LLM provider (GPT models)',
    required: false,
    docsUrl: 'https://platform.openai.com/',
  },
  {
    id: 'anthropic',
    name: 'Anthropic API Key',
    service: 'Anthropic',
    description: 'Alternative LLM provider (Claude models)',
    required: false,
    docsUrl: 'https://console.anthropic.com/',
  },
  {
    id: 'spotify',
    name: 'Spotify Client Credentials',
    service: 'Spotify',
    description: 'Music playback control integration',
    required: false,
    docsUrl: 'https://developer.spotify.com/',
  },
];

// ============================================================================
// Main Component
// ============================================================================

export const APIKeyManager: React.FC<APIKeyManagerProps> = ({ isVisible, onClose }) => {
  const [keys, setKeys] = useState<APIKeyConfig[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load configured status
  useEffect(() => {
    if (!isVisible) return;
    loadKeyStatus();
  }, [isVisible]);

  const loadKeyStatus = async () => {
    try {
      // Try to get status from IPC - security API may not be exposed
      const atlasAny = window.atlas as unknown as Record<string, unknown>;
      if (atlasAny?.security && typeof atlasAny.security === 'object') {
        const securityApi = atlasAny.security as { getKeyStatus?: () => Promise<{ success: boolean; data?: Record<string, { configured: boolean; maskedValue?: string }> }> };
        const result = await securityApi.getKeyStatus?.();
        if (result?.success && result.data) {
          const status = result.data;
          setKeys(API_SERVICES.map(service => ({
            ...service,
            configured: status[service.id]?.configured || false,
            maskedValue: status[service.id]?.maskedValue,
          })));
          return;
        }
      }
      
      // SECURITY: No fallback to localStorage - only use secure keychain
      // If secure storage is not available, show all keys as unconfigured
      setKeys(API_SERVICES.map(service => ({
        ...service,
        configured: false,
        maskedValue: undefined,
      })));
    } catch (error) {
      // Initialize with default state
      setKeys(API_SERVICES.map(service => ({
        ...service,
        configured: false,
      })));
    }
  };

  // Save key
  const saveKey = useCallback(async (keyId: string, value: string) => {
    if (!value.trim()) {
      setMessage({ type: 'error', text: 'Please enter a valid API key' });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      // SECURITY: Only use secure keychain storage
      const atlasAny = window.atlas as unknown as Record<string, unknown>;

      if (!atlasAny?.security || typeof atlasAny.security !== 'object') {
        setMessage({
          type: 'error',
          text: 'Secure storage not available. Please restart the application.'
        });
        return;
      }

      const securityApi = atlasAny.security as {
        setApiKey?: (keyId: string, value: string) => Promise<{ success: boolean }>
      };

      if (!securityApi.setApiKey) {
        setMessage({
          type: 'error',
          text: 'API key storage service not available.'
        });
        return;
      }

      const result = await securityApi.setApiKey(keyId, value);

      if (!result?.success) {
        setMessage({
          type: 'error',
          text: 'Failed to save API key to secure storage.'
        });
        return;
      }

      setMessage({ type: 'success', text: 'API key saved securely' });

      // Update local state
      setKeys(prev => prev.map(k =>
        k.id === keyId
          ? { ...k, configured: true, maskedValue: '****' + value.slice(-4) }
          : k
      ));
      setEditingKey(null);
      setInputValue('');
    } catch (error) {
      setMessage({
        type: 'error',
        text: `Failed to save API key: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } finally {
      setSaving(false);
    }
  }, []);

  // Delete key
  const deleteKey = useCallback(async (keyId: string) => {
    if (!confirm('Are you sure you want to remove this API key?')) return;

    try {
      // SECURITY: Only delete from secure keychain
      const atlasAny = window.atlas as unknown as Record<string, unknown>;

      if (!atlasAny?.security || typeof atlasAny.security !== 'object') {
        setMessage({
          type: 'error',
          text: 'Secure storage not available. Please restart the application.'
        });
        return;
      }

      const securityApi = atlasAny.security as { deleteApiKey?: (keyId: string) => Promise<void> };

      if (!securityApi.deleteApiKey) {
        setMessage({
          type: 'error',
          text: 'API key deletion service not available.'
        });
        return;
      }

      await securityApi.deleteApiKey(keyId);

      setKeys(prev => prev.map(k =>
        k.id === keyId
          ? { ...k, configured: false, maskedValue: undefined }
          : k
      ));
      setMessage({ type: 'success', text: 'API key removed securely' });
    } catch (error) {
      setMessage({
        type: 'error',
        text: `Failed to remove API key: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }, []);

  // Clear message after timeout
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [message]);

  // Count configured required keys
  const requiredCount = keys.filter(k => k.required).length;
  const configuredRequired = keys.filter(k => k.required && k.configured).length;

  if (!isVisible) return null;

  return (
    <div className="api-key-manager-overlay">
      <div className="api-key-manager-container">
        {/* Header */}
        <div className="akm-header">
          <div className="akm-title-row">
            <KeyIcon className="akm-icon" />
            <h2>API Key Manager</h2>
          </div>
          <button className="akm-close" onClick={onClose}>
            <XIcon />
          </button>
        </div>

        {/* Security Notice */}
        <div className="akm-security-notice">
          <ShieldIcon className="shield-icon" />
          <div className="notice-text">
            <strong>Your keys are stored securely</strong>
            <span>API keys are encrypted and stored in your system keychain</span>
          </div>
        </div>

        {/* Progress */}
        <div className="akm-progress">
          <div className="progress-header">
            <span>Required Keys</span>
            <span className="progress-count">
              {configuredRequired} / {requiredCount} configured
            </span>
          </div>
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${(configuredRequired / requiredCount) * 100}%` }}
            />
          </div>
        </div>

        {/* Message */}
        {message && (
          <div className={`akm-message ${message.type}`}>
            {message.type === 'success' ? <CheckIcon /> : <AlertIcon />}
            {message.text}
          </div>
        )}

        {/* Keys List */}
        <div className="akm-content">
          <div className="keys-section">
            <h3>Required Services</h3>
            {keys.filter(k => k.required).map(key => (
              <div key={key.id} className={`key-card ${key.configured ? 'configured' : ''}`}>
                <div className="key-header">
                  <div className="key-info">
                    <div className="key-title">
                      {key.configured ? (
                        <CheckIcon className="status-icon configured" />
                      ) : (
                        <AlertIcon className="status-icon missing" />
                      )}
                      <span className="key-name">{key.name}</span>
                    </div>
                    <span className="key-service">{key.service}</span>
                  </div>
                  {key.docsUrl && (
                    <a 
                      href={key.docsUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="docs-link"
                      title="Get API Key"
                    >
                      <ExternalIcon />
                    </a>
                  )}
                </div>
                
                <p className="key-description">{key.description}</p>

                {editingKey === key.id ? (
                  <div className="key-input-row">
                    <div className="input-wrapper">
                      <input
                        type={showValue ? 'text' : 'password'}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder="Enter your API key..."
                        autoFocus
                      />
                      <button 
                        className="toggle-visibility"
                        onClick={() => setShowValue(!showValue)}
                      >
                        {showValue ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                    <div className="input-actions">
                      <button 
                        className="cancel-btn"
                        onClick={() => { setEditingKey(null); setInputValue(''); }}
                      >
                        Cancel
                      </button>
                      <button 
                        className="save-btn"
                        onClick={() => saveKey(key.id, inputValue)}
                        disabled={saving}
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="key-actions-row">
                    {key.configured && (
                      <span className="masked-value">{key.maskedValue}</span>
                    )}
                    <div className="action-buttons">
                      <button 
                        className="edit-btn"
                        onClick={() => { setEditingKey(key.id); setInputValue(''); }}
                      >
                        {key.configured ? 'Update' : 'Add Key'}
                      </button>
                      {key.configured && (
                        <button 
                          className="delete-btn"
                          onClick={() => deleteKey(key.id)}
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="keys-section">
            <h3>Optional Services</h3>
            {keys.filter(k => !k.required).map(key => (
              <div key={key.id} className={`key-card ${key.configured ? 'configured' : ''}`}>
                <div className="key-header">
                  <div className="key-info">
                    <div className="key-title">
                      {key.configured ? (
                        <CheckIcon className="status-icon configured" />
                      ) : (
                        <span className="status-dot" />
                      )}
                      <span className="key-name">{key.name}</span>
                    </div>
                    <span className="key-service">{key.service}</span>
                  </div>
                  {key.docsUrl && (
                    <a 
                      href={key.docsUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="docs-link"
                      title="Get API Key"
                    >
                      <ExternalIcon />
                    </a>
                  )}
                </div>
                
                <p className="key-description">{key.description}</p>

                {editingKey === key.id ? (
                  <div className="key-input-row">
                    <div className="input-wrapper">
                      <input
                        type={showValue ? 'text' : 'password'}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder="Enter your API key..."
                        autoFocus
                      />
                      <button 
                        className="toggle-visibility"
                        onClick={() => setShowValue(!showValue)}
                      >
                        {showValue ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                    <div className="input-actions">
                      <button 
                        className="cancel-btn"
                        onClick={() => { setEditingKey(null); setInputValue(''); }}
                      >
                        Cancel
                      </button>
                      <button 
                        className="save-btn"
                        onClick={() => saveKey(key.id, inputValue)}
                        disabled={saving}
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="key-actions-row">
                    {key.configured && (
                      <span className="masked-value">{key.maskedValue}</span>
                    )}
                    <div className="action-buttons">
                      <button 
                        className="edit-btn"
                        onClick={() => { setEditingKey(key.id); setInputValue(''); }}
                      >
                        {key.configured ? 'Update' : 'Add Key'}
                      </button>
                      {key.configured && (
                        <button 
                          className="delete-btn"
                          onClick={() => deleteKey(key.id)}
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default APIKeyManager;
