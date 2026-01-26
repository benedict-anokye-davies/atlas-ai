/**
 * Atlas Desktop - Onboarding Component
 * First-run experience with step-by-step setup flow
 */

import React, { useCallback, useEffect } from 'react';
import {
  useOnboardingStore,
  type OnboardingStep,
  getStepIndex,
  getTotalSteps,
} from '../stores/onboardingStore';
import { StepMicrophone } from './onboarding/StepMicrophone';
import { StepWakeWord } from './onboarding/StepWakeWord';
import { StepApiKeys } from './onboarding/StepApiKeys';
import { StepPersonalization } from './onboarding/StepPersonalization';
import './Onboarding.css';

/**
 * Welcome step component
 */
const StepWelcome: React.FC<{ onComplete: () => void }> = ({ onComplete }) => (
  <div className="onboarding-step step-welcome">
    <div className="welcome-logo">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="96"
        height="96"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="atlas-logo"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        <path d="M2 12h20" />
      </svg>
    </div>

    <h1 className="welcome-title">Welcome to Atlas</h1>
    <p className="welcome-subtitle">Your AI-powered voice assistant</p>

    <div className="welcome-features">
      <div className="feature-item">
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
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>
        <span>Voice-activated with &quot;Hey Atlas&quot;</span>
      </div>
      <div className="feature-item">
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
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span>Natural conversations</span>
      </div>
      <div className="feature-item">
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
        <span>Private and secure</span>
      </div>
    </div>

    <button className="onboarding-button primary large" onClick={onComplete}>
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

/**
 * Progress indicator component
 */
const ProgressIndicator: React.FC<{
  currentStep: OnboardingStep;
  stepProgress: Record<OnboardingStep, boolean>;
}> = ({ currentStep, stepProgress }) => {
  const steps: Array<{ key: OnboardingStep; label: string }> = [
    { key: 'welcome', label: 'Welcome' },
    { key: 'microphone', label: 'Microphone' },
    { key: 'wakeWord', label: 'Wake Word' },
    { key: 'apiKeys', label: 'API Keys' },
    { key: 'personalization', label: 'Personalize' },
  ];

  const currentIndex = getStepIndex(currentStep);

  return (
    <div className="progress-indicator">
      <div className="progress-steps">
        {steps.map((step, index) => (
          <div
            key={step.key}
            className={`progress-step ${
              index === currentIndex
                ? 'current'
                : index < currentIndex || stepProgress[step.key]
                  ? 'completed'
                  : 'pending'
            }`}
          >
            <div className="step-dot">
              {index < currentIndex || stepProgress[step.key] ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <span className="step-number">{index + 1}</span>
              )}
            </div>
            <span className="step-label">{step.label}</span>
          </div>
        ))}
      </div>
      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{
            width: `${(currentIndex / (getTotalSteps() - 1)) * 100}%`,
          }}
        />
      </div>
    </div>
  );
};

/**
 * Main Onboarding Component
 */
export const Onboarding: React.FC = () => {
  const {
    isComplete,
    currentStep,
    stepProgress,
    nextStep,
    previousStep,
    skipOnboarding,
    completeStep,
  } = useOnboardingStore();

  // Handle step completion
  const handleStepComplete = useCallback(() => {
    completeStep(currentStep);
    nextStep();
  }, [completeStep, currentStep, nextStep]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Allow escape to skip onboarding
        const confirmed = window.confirm(
          'Skip the setup? You can configure these settings later in Settings.'
        );
        if (confirmed) {
          skipOnboarding();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [skipOnboarding]);

  // Don't render if onboarding is complete
  if (isComplete) {
    return null;
  }

  // Render current step
  const renderStep = () => {
    switch (currentStep) {
      case 'welcome':
        return <StepWelcome onComplete={handleStepComplete} />;
      case 'microphone':
        return <StepMicrophone onComplete={handleStepComplete} />;
      case 'wakeWord':
        return <StepWakeWord onComplete={handleStepComplete} />;
      case 'apiKeys':
        return <StepApiKeys onComplete={handleStepComplete} />;
      case 'personalization':
        return <StepPersonalization onComplete={() => {}} />;
      default:
        return <StepWelcome onComplete={handleStepComplete} />;
    }
  };

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-container">
        {/* Skip Button */}
        <button
          className="skip-button"
          onClick={skipOnboarding}
          aria-label="Skip onboarding"
          title="Skip setup (Esc)"
        >
          Skip
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
        </button>

        {/* Progress Indicator */}
        <ProgressIndicator currentStep={currentStep} stepProgress={stepProgress} />

        {/* Step Content */}
        <div className="onboarding-content">{renderStep()}</div>

        {/* Back Button (not on welcome or first step) */}
        {currentStep !== 'welcome' && (
          <button className="back-button" onClick={previousStep} aria-label="Go back">
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
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            Back
          </button>
        )}
      </div>
    </div>
  );
};

export default Onboarding;
