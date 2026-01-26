/**
 * Atlas Desktop - Onboarding Step: Welcome Screen
 * First-time user welcome with Atlas introduction
 */

import React from 'react';
import { useOnboardingStore } from '../../stores/onboardingStore';

interface StepWelcomeProps {
  onComplete: () => void;
}

export const StepWelcome: React.FC<StepWelcomeProps> = ({ onComplete }) => {
  const { completeStep } = useOnboardingStore();

  const handleGetStarted = () => {
    completeStep('welcome');
    onComplete();
  };

  return (
    <div className="onboarding-step step-welcome">
      {/* Atlas Logo/Icon */}
      <div className="welcome-logo">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="80"
          height="80"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" className="logo-circle" />
          <path d="M12 2a10 10 0 0 1 0 20" className="logo-half" />
          <circle cx="12" cy="12" r="4" className="logo-core" />
          <line x1="12" y1="2" x2="12" y2="6" />
          <line x1="12" y1="18" x2="12" y2="22" />
          <line x1="2" y1="12" x2="6" y2="12" />
          <line x1="18" y1="12" x2="22" y2="12" />
        </svg>
      </div>

      <h1 className="welcome-title">Welcome to Atlas</h1>
      <p className="welcome-subtitle">Your AI voice assistant for desktop</p>

      <div className="welcome-features">
        <div className="feature">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          </svg>
          <span>Voice-first interaction</span>
        </div>

        <div className="feature">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
          </svg>
          <span>Powered by advanced AI</span>
        </div>

        <div className="feature">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>Privacy-focused &amp; secure</span>
        </div>
      </div>

      <p className="welcome-description">
        Let&apos;s get you set up in just a few quick steps. We&apos;ll configure your microphone, wake word,
        and personalize your experience.
      </p>

      <button className="onboarding-button primary large" onClick={handleGetStarted}>
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
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </button>
    </div>
  );
};

export default StepWelcome;
