/**
 * Atlas Desktop - Onboarding Components
 * Export all onboarding step components
 */

export { OnboardingWizard } from './OnboardingWizard';
export { StepWelcome } from './StepWelcome';
export { StepMicrophone } from './StepMicrophone';
export { StepWakeWord } from './StepWakeWord';
export { StepApiKeys } from './StepApiKeys';
export { StepPersonalization } from './StepPersonalization';

// Re-export onboarding store
export {
  useOnboardingStore,
  selectCurrentStep,
  selectIsComplete,
  selectStepProgress,
  selectApiKeys,
  selectPersonalization,
  getStepIndex,
  getTotalSteps,
} from '../../stores/onboardingStore';
export type { OnboardingStep } from '../../stores/onboardingStore';
