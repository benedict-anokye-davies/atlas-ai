/**
 * Atlas Desktop - Progress Bar Component
 * Progress feedback for long-running operations
 */

import React from 'react';

type ProgressSize = 'small' | 'medium' | 'large';
type ProgressVariant = 'determinate' | 'indeterminate';

interface ProgressBarProps {
  /** Current progress value (0-100) for determinate variant */
  value?: number;
  /** Whether the progress is determinate or indeterminate */
  variant?: ProgressVariant;
  /** Size of the progress bar */
  size?: ProgressSize;
  /** Label text to display */
  label?: string;
  /** Whether to show percentage */
  showPercentage?: boolean;
  /** Color variant */
  color?: 'primary' | 'success' | 'warning' | 'error';
  /** Additional CSS class */
  className?: string;
}

/**
 * ProgressBar - Unified progress feedback component
 *
 * @example
 * // Determinate progress
 * <ProgressBar value={75} showPercentage />
 *
 * @example
 * // Indeterminate progress
 * <ProgressBar variant="indeterminate" label="Processing..." />
 *
 * @example
 * // With success color
 * <ProgressBar value={100} color="success" label="Complete!" />
 */
export const ProgressBar: React.FC<ProgressBarProps> = ({
  value = 0,
  variant = 'determinate',
  size = 'medium',
  label,
  showPercentage = false,
  color = 'primary',
  className = '',
}) => {
  const clampedValue = Math.min(100, Math.max(0, value));

  return (
    <div
      className={`progress-bar-container progress-${size} progress-${color} ${className}`}
      role="progressbar"
      aria-valuenow={variant === 'determinate' ? clampedValue : undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label || 'Progress'}
    >
      {(label || showPercentage) && (
        <div className="progress-header">
          {label && <span className="progress-label">{label}</span>}
          {showPercentage && variant === 'determinate' && (
            <span className="progress-percentage">{Math.round(clampedValue)}%</span>
          )}
        </div>
      )}
      <div className="progress-track">
        <div
          className={`progress-fill progress-${variant}`}
          style={variant === 'determinate' ? { width: `${clampedValue}%` } : undefined}
        />
      </div>
    </div>
  );
};

/**
 * Circular progress indicator
 */
interface CircularProgressProps {
  /** Current progress value (0-100) */
  value?: number;
  /** Size in pixels */
  size?: number;
  /** Stroke width */
  strokeWidth?: number;
  /** Whether to show center value */
  showValue?: boolean;
  /** Color variant */
  color?: 'primary' | 'success' | 'warning' | 'error';
  /** Additional CSS class */
  className?: string;
}

export const CircularProgress: React.FC<CircularProgressProps> = ({
  value = 0,
  size = 48,
  strokeWidth = 4,
  showValue = false,
  color = 'primary',
  className = '',
}) => {
  const clampedValue = Math.min(100, Math.max(0, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (clampedValue / 100) * circumference;

  return (
    <div
      className={`circular-progress circular-${color} ${className}`}
      role="progressbar"
      aria-valuenow={clampedValue}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="circular-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
        />
        <circle
          className="circular-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {showValue && (
        <div className="circular-value">
          <span>{Math.round(clampedValue)}%</span>
        </div>
      )}
    </div>
  );
};

/**
 * Steps progress indicator
 */
interface StepsProgressProps {
  /** Current step (1-indexed) */
  currentStep: number;
  /** Total number of steps */
  totalSteps: number;
  /** Step labels */
  labels?: string[];
  /** Additional CSS class */
  className?: string;
}

export const StepsProgress: React.FC<StepsProgressProps> = ({
  currentStep,
  totalSteps,
  labels = [],
  className = '',
}) => {
  return (
    <div className={`steps-progress ${className}`} role="navigation" aria-label="Progress steps">
      <div className="steps-container">
        {Array.from({ length: totalSteps }).map((_, index) => {
          const stepNumber = index + 1;
          const isCompleted = stepNumber < currentStep;
          const isCurrent = stepNumber === currentStep;

          return (
            <React.Fragment key={stepNumber}>
              <div
                className={`step ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}`}
                aria-current={isCurrent ? 'step' : undefined}
              >
                <div className="step-indicator">
                  {isCompleted ? (
                    <svg
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
                    <span>{stepNumber}</span>
                  )}
                </div>
                {labels[index] && <span className="step-label">{labels[index]}</span>}
              </div>
              {stepNumber < totalSteps && (
                <div className={`step-connector ${isCompleted ? 'completed' : ''}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default ProgressBar;
