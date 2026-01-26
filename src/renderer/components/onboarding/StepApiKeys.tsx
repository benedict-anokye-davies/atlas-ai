/**
 * Atlas Desktop - Onboarding Step: API Keys Setup
 * Guides users through API key configuration with validation
 */

import React, { useCallback, useState } from 'react';
import { useOnboardingStore, type ApiKeyStatus } from '../../stores/onboardingStore';

interface StepApiKeysProps {
  onComplete: () => void;
}

/**
 * API Key configuration
 */
interface ApiKeyConfig {
  key: keyof ReturnType<typeof useOnboardingStore.getState>['apiKeys'];
  name: string;
  description: string;
  required: boolean;
  link: string;
  placeholder: string;
}

const API_KEYS_CONFIG: ApiKeyConfig[] = [
  {
    key: 'porcupine',
    name: 'Picovoice (Porcupine)',
    description: 'Wake word detection - "Hey Atlas"',
    required: true,
    link: 'https://console.picovoice.ai/',
    placeholder: 'Enter your Picovoice API key',
  },
  {
    key: 'deepgram',
    name: 'Deepgram',
    description: 'Speech-to-text transcription',
    required: true,
    link: 'https://console.deepgram.com/',
    placeholder: 'Enter your Deepgram API key',
  },
  {
    key: 'elevenlabs',
    name: 'ElevenLabs',
    description: 'Text-to-speech voice synthesis',
    required: true,
    link: 'https://elevenlabs.io/app/settings/api-keys',
    placeholder: 'Enter your ElevenLabs API key',
  },
  {
    key: 'fireworks',
    name: 'Fireworks AI',
    description: 'Primary LLM (DeepSeek V3.1)',
    required: true,
    link: 'https://fireworks.ai/account/api-keys',
    placeholder: 'Enter your Fireworks API key',
  },
  {
    key: 'openrouter',
    name: 'OpenRouter',
    description: 'Fallback LLM provider',
    required: false,
    link: 'https://openrouter.ai/keys',
    placeholder: 'Enter your OpenRouter API key (optional)',
  },
];

/**
 * Status indicator component
 */
const StatusIndicator: React.FC<{ status: ApiKeyStatus }> = ({ status }) => {
  if (status.isValidating) {
    return (
      <span className="status-indicator validating">
        <span className="spinner small" />
      </span>
    );
  }

  if (status.isValid === true) {
    return (
      <span className="status-indicator valid">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }

  if (status.isValid === false) {
    return (
      <span className="status-indicator invalid">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </span>
    );
  }

  return null;
};

/**
 * Single API Key input component
 */
const ApiKeyInput: React.FC<{
  config: ApiKeyConfig;
  status: ApiKeyStatus;
  onChange: (value: string) => void;
  onValidate: () => void;
}> = ({ config, status, onChange, onValidate }) => {
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="api-key-item">
      <div className="api-key-header">
        <div className="api-key-info">
          <div className="api-key-name">
            {config.name}
            {config.required && <span className="required-badge">Required</span>}
          </div>
          <div className="api-key-description">{config.description}</div>
        </div>
        <StatusIndicator status={status} />
      </div>

      <div className="api-key-input-row">
        <div className="input-wrapper">
          <input
            type={showKey ? 'text' : 'password'}
            value={status.key}
            onChange={(e) => onChange(e.target.value)}
            placeholder={config.placeholder}
            className={`api-key-input ${status.isValid === false ? 'error' : ''} ${
              status.isValid === true ? 'valid' : ''
            }`}
            autoComplete="off"
          />
          <button
            type="button"
            className="toggle-visibility"
            onClick={() => setShowKey(!showKey)}
            aria-label={showKey ? 'Hide API key' : 'Show API key'}
          >
            {showKey ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>

        <button
          type="button"
          className="validate-button"
          onClick={onValidate}
          disabled={!status.key || status.isValidating}
        >
          Validate
        </button>
      </div>

      {status.error && <div className="api-key-error">{status.error}</div>}

      <a href={config.link} target="_blank" rel="noopener noreferrer" className="get-key-link">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
        Get API key
      </a>
    </div>
  );
};

export const StepApiKeys: React.FC<StepApiKeysProps> = ({ onComplete }) => {
  const {
    apiKeys,
    setApiKey,
    setApiKeyValidating,
    setApiKeyValid,
    skipApiKeys,
    completeStep,
  } = useOnboardingStore();

  const [expandedSection, setExpandedSection] = useState<'required' | 'optional'>('required');

  // Validate an API key
  const validateKey = useCallback(
    async (keyType: keyof typeof apiKeys) => {
      const key = apiKeys[keyType].key;
      if (!key) return;

      setApiKeyValidating(keyType, true);

      try {
        // Call main process to validate the API key
        let result: { success: boolean; error?: string } | undefined;

        switch (keyType) {
          case 'porcupine':
            result = await window.atlas?.atlas.validateApiKey('porcupine', key);
            break;
          case 'deepgram':
            result = await window.atlas?.atlas.validateApiKey('deepgram', key);
            break;
          case 'elevenlabs':
            result = await window.atlas?.atlas.validateApiKey('elevenlabs', key);
            break;
          case 'fireworks':
            result = await window.atlas?.atlas.validateApiKey('fireworks', key);
            break;
          case 'openrouter':
            result = await window.atlas?.atlas.validateApiKey('openrouter', key);
            break;
        }

        if (result?.success) {
          setApiKeyValid(keyType, true);
          // Save the key to config
          await window.atlas?.atlas.setApiKey(keyType, key);
        } else {
          setApiKeyValid(keyType, false, result?.error || 'Invalid API key');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Validation failed';
        setApiKeyValid(keyType, false, errorMessage);
      }
    },
    [apiKeys, setApiKeyValidating, setApiKeyValid]
  );

  // Check if all required keys are valid
  const allRequiredKeysValid = API_KEYS_CONFIG.filter((c) => c.required).every(
    (config) => apiKeys[config.key].isValid === true
  );

  // Check if at least some keys are provided
  const hasAnyKeys = Object.values(apiKeys).some((status) => status.key.length > 0);

  // Handle continue
  const handleContinue = useCallback(() => {
    completeStep('apiKeys');
    onComplete();
  }, [completeStep, onComplete]);

  // Required keys
  const requiredKeys = API_KEYS_CONFIG.filter((c) => c.required);
  // Optional keys
  const optionalKeys = API_KEYS_CONFIG.filter((c) => !c.required);

  return (
    <div className="onboarding-step step-api-keys">
      <div className="step-icon">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
        </svg>
      </div>

      <h2 className="step-title">API Keys Setup</h2>
      <p className="step-description">
        Atlas uses several AI services to provide the best experience. Configure your API keys
        below. You can skip this step and configure them later in Settings.
      </p>

      {/* Required Keys Section */}
      <div className="api-keys-section">
        <button
          className={`section-header ${expandedSection === 'required' ? 'expanded' : ''}`}
          onClick={() => setExpandedSection(expandedSection === 'required' ? 'optional' : 'required')}
        >
          <span className="section-title">
            Required Keys
            <span className="key-count">
              {requiredKeys.filter((c) => apiKeys[c.key].isValid === true).length}/{requiredKeys.length}
            </span>
          </span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="chevron"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {expandedSection === 'required' && (
          <div className="api-keys-list">
            {requiredKeys.map((config) => (
              <ApiKeyInput
                key={config.key}
                config={config}
                status={apiKeys[config.key]}
                onChange={(value) => setApiKey(config.key, value)}
                onValidate={() => validateKey(config.key)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Optional Keys Section */}
      <div className="api-keys-section">
        <button
          className={`section-header ${expandedSection === 'optional' ? 'expanded' : ''}`}
          onClick={() => setExpandedSection(expandedSection === 'optional' ? 'required' : 'optional')}
        >
          <span className="section-title">
            Optional Keys
            <span className="key-count">
              {optionalKeys.filter((c) => apiKeys[c.key].isValid === true).length}/{optionalKeys.length}
            </span>
          </span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="chevron"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {expandedSection === 'optional' && (
          <div className="api-keys-list">
            {optionalKeys.map((config) => (
              <ApiKeyInput
                key={config.key}
                config={config}
                status={apiKeys[config.key]}
                onChange={(value) => setApiKey(config.key, value)}
                onValidate={() => validateKey(config.key)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Status Message */}
      {allRequiredKeysValid && (
        <div className="success-message">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>All required keys are configured!</span>
        </div>
      )}

      {/* Button Group */}
      <div className="button-group">
        <button className="onboarding-button text" onClick={skipApiKeys}>
          Skip for now
        </button>

        <button
          className="onboarding-button primary"
          onClick={handleContinue}
          disabled={hasAnyKeys && !allRequiredKeysValid}
        >
          {allRequiredKeysValid ? 'Continue' : 'Continue without keys'}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default StepApiKeys;
