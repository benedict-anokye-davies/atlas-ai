/**
 * Atlas Desktop - Onboarding Step: Personalization
 * Basic user preferences and personalization settings
 */

import React, { useCallback } from 'react';
import { useOnboardingStore } from '../../stores/onboardingStore';

interface StepPersonalizationProps {
  onComplete: () => void;
}

/**
 * Voice option cards
 */
const VOICE_OPTIONS = [
  {
    id: 'default' as const,
    name: 'Atlas',
    description: 'Balanced and natural',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M8 12h.01" />
        <path d="M16 12h.01" />
        <path d="M9 16s1 2 3 2 3-2 3-2" />
      </svg>
    ),
  },
  {
    id: 'warm' as const,
    name: 'Warm',
    description: 'Friendly and approachable',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      </svg>
    ),
  },
  {
    id: 'professional' as const,
    name: 'Professional',
    description: 'Formal and precise',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 7h-9" />
        <path d="M14 17H5" />
        <circle cx="17" cy="17" r="3" />
        <circle cx="7" cy="7" r="3" />
      </svg>
    ),
  },
];

export const StepPersonalization: React.FC<StepPersonalizationProps> = ({ onComplete }) => {
  const { personalization, setPersonalization, finishOnboarding } = useOnboardingStore();

  // Handle name change
  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setPersonalization({ name: e.target.value });
    },
    [setPersonalization]
  );

  // Handle voice selection
  const handleVoiceSelect = useCallback(
    (voice: 'default' | 'warm' | 'professional') => {
      setPersonalization({ preferredVoice: voice });
    },
    [setPersonalization]
  );

  // Handle sound toggle
  const handleSoundToggle = useCallback(() => {
    setPersonalization({ enableSounds: !personalization.enableSounds });
  }, [personalization.enableSounds, setPersonalization]);

  // Handle finish
  const handleFinish = useCallback(() => {
    finishOnboarding();
    onComplete();
  }, [finishOnboarding, onComplete]);

  return (
    <div className="onboarding-step step-personalization">
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
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>

      <h2 className="step-title">Personalize Atlas</h2>
      <p className="step-description">
        Let us get to know you better. These settings help Atlas provide a more personalized
        experience.
      </p>

      {/* Name Input */}
      <div className="personalization-section">
        <label className="section-label" htmlFor="user-name">
          What should Atlas call you?
        </label>
        <input
          id="user-name"
          type="text"
          value={personalization.name}
          onChange={handleNameChange}
          placeholder="Enter your name"
          className="name-input"
          maxLength={50}
          autoComplete="name"
        />
        <p className="input-hint">
          This is optional. Atlas will use this name when talking to you.
        </p>
      </div>

      {/* Voice Selection */}
      <div className="personalization-section">
        <label className="section-label">Choose a voice style</label>
        <div className="voice-options">
          {VOICE_OPTIONS.map((voice) => (
            <button
              key={voice.id}
              type="button"
              className={`voice-option ${personalization.preferredVoice === voice.id ? 'selected' : ''}`}
              onClick={() => handleVoiceSelect(voice.id)}
            >
              <div className="voice-icon">{voice.icon}</div>
              <div className="voice-info">
                <span className="voice-name">{voice.name}</span>
                <span className="voice-description">{voice.description}</span>
              </div>
              {personalization.preferredVoice === voice.id && (
                <div className="selected-check">
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
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Sound Effects Toggle */}
      <div className="personalization-section">
        <div className="toggle-row">
          <div className="toggle-info">
            <span className="toggle-label">Sound Effects</span>
            <span className="toggle-description">
              Play sounds for wake word detection and state changes
            </span>
          </div>
          <button
            type="button"
            className={`toggle-switch ${personalization.enableSounds ? 'active' : ''}`}
            onClick={handleSoundToggle}
            aria-pressed={personalization.enableSounds}
          >
            <span className="toggle-slider" />
          </button>
        </div>
      </div>

      {/* Greeting Preview */}
      {personalization.name && (
        <div className="greeting-preview">
          <div className="preview-label">Preview</div>
          <div className="preview-message">
            <span className="atlas-name">Atlas:</span> Hello{personalization.name ? `, ${personalization.name}` : ''}! How can I help you today?
          </div>
        </div>
      )}

      {/* Button Group */}
      <div className="button-group">
        <button className="onboarding-button primary large" onClick={handleFinish}>
          Get Started
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
            <polyline points="13 17 18 12 13 7" />
            <polyline points="6 17 11 12 6 7" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default StepPersonalization;
