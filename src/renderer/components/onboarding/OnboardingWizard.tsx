/**
 * Atlas Desktop - Onboarding Wizard
 * Main container that orchestrates the onboarding flow
 */

import React, { useCallback } from 'react';
import {
  useOnboardingStore,
  getStepIndex,
  getTotalSteps,
  OnboardingStep,
} from '../../stores/onboardingStore';
import { StepWelcome } from './StepWelcome';
import { StepMicrophone } from './StepMicrophone';
import { StepWakeWord } from './StepWakeWord';
import { StepApiKeys } from './StepApiKeys';
import { StepPersonalization } from './StepPersonalization';

interface OnboardingWizardProps {
  onComplete?: () => void;
}

/**
 * Progress indicator component
 */
const ProgressIndicator: React.FC<{ currentStep: OnboardingStep }> = ({ currentStep }) => {
  const currentIndex = getStepIndex(currentStep);
  const totalSteps = getTotalSteps();

  // Don't show progress on welcome step
  if (currentStep === 'welcome') return null;

  return (
    <div className="onboarding-progress">
      <div className="progress-dots">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={`progress-dot ${i < currentIndex ? 'completed' : ''} ${
              i === currentIndex ? 'current' : ''
            }`}
          />
        ))}
      </div>
      <span className="progress-text">
        Step {currentIndex + 1} of {totalSteps}
      </span>
    </div>
  );
};

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onComplete }) => {
  const { currentStep, isComplete, nextStep, skipOnboarding, finishOnboarding } =
    useOnboardingStore();

  // Handle step completion
  const handleStepComplete = useCallback(() => {
    const totalSteps = getTotalSteps();
    const currentIndex = getStepIndex(currentStep);

    if (currentIndex >= totalSteps - 1) {
      // Last step - finish onboarding
      finishOnboarding();
      onComplete?.();
    } else {
      // Move to next step
      nextStep();
    }
  }, [currentStep, nextStep, finishOnboarding, onComplete]);

  // Handle skip
  const handleSkip = useCallback(() => {
    skipOnboarding();
    onComplete?.();
  }, [skipOnboarding, onComplete]);

  // Don't render if already complete
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
        return <StepPersonalization onComplete={handleStepComplete} />;
      default:
        return null;
    }
  };

  return (
    <div className="onboarding-wizard">
      <div className="onboarding-header">
        <ProgressIndicator currentStep={currentStep} />
        {currentStep !== 'welcome' && (
          <button className="skip-button" onClick={handleSkip}>
            Skip setup
          </button>
        )}
      </div>

      <div className="onboarding-content">{renderStep()}</div>
    </div>
  );
};

export default OnboardingWizard;
