/**
 * Atlas Desktop - Loading Indicator Component
 * Unified loading state visualization for async operations
 */

import React from 'react';

type LoadingSize = 'small' | 'medium' | 'large';
type LoadingVariant = 'spinner' | 'dots' | 'pulse';

interface LoadingIndicatorProps {
  /** Size of the loading indicator */
  size?: LoadingSize;
  /** Visual variant */
  variant?: LoadingVariant;
  /** Optional text to display */
  text?: string;
  /** Whether to show as inline or block */
  inline?: boolean;
  /** Additional CSS class */
  className?: string;
}

/**
 * Spinner loading indicator with rotating animation
 */
const Spinner: React.FC<{ size: LoadingSize }> = ({ size }) => {
  const sizeMap = {
    small: 16,
    medium: 24,
    large: 40,
  };
  const dimension = sizeMap[size];

  return (
    <svg
      className={`loading-spinner loading-${size}`}
      width={dimension}
      height={dimension}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        className="spinner-track"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="3"
        fill="none"
      />
      <path
        className="spinner-head"
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
};

/**
 * Animated dots loading indicator
 */
const Dots: React.FC<{ size: LoadingSize }> = ({ size }) => {
  const sizeMap = {
    small: 4,
    medium: 6,
    large: 8,
  };
  const dotSize = sizeMap[size];

  return (
    <div className={`loading-dots loading-${size}`}>
      <span className="dot dot-1" style={{ width: dotSize, height: dotSize }} />
      <span className="dot dot-2" style={{ width: dotSize, height: dotSize }} />
      <span className="dot dot-3" style={{ width: dotSize, height: dotSize }} />
    </div>
  );
};

/**
 * Pulse loading indicator
 */
const Pulse: React.FC<{ size: LoadingSize }> = ({ size }) => {
  const sizeMap = {
    small: 16,
    medium: 24,
    large: 40,
  };
  const dimension = sizeMap[size];

  return (
    <div
      className={`loading-pulse loading-${size}`}
      style={{ width: dimension, height: dimension }}
    >
      <div className="pulse-ring" />
      <div className="pulse-core" />
    </div>
  );
};

/**
 * LoadingIndicator - Unified loading state component
 *
 * @example
 * // Simple spinner
 * <LoadingIndicator />
 *
 * @example
 * // With text
 * <LoadingIndicator text="Loading data..." />
 *
 * @example
 * // Large dots variant
 * <LoadingIndicator variant="dots" size="large" />
 */
export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  size = 'medium',
  variant = 'spinner',
  text,
  inline = false,
  className = '',
}) => {
  const renderIndicator = () => {
    switch (variant) {
      case 'dots':
        return <Dots size={size} />;
      case 'pulse':
        return <Pulse size={size} />;
      case 'spinner':
      default:
        return <Spinner size={size} />;
    }
  };

  return (
    <div
      className={`loading-indicator ${inline ? 'inline' : 'block'} ${className}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      {renderIndicator()}
      {text && <span className="loading-text">{text}</span>}
      <span className="sr-only">{text || 'Loading...'}</span>
    </div>
  );
};

/**
 * Loading overlay for blocking operations
 */
export const LoadingOverlay: React.FC<{
  text?: string;
  transparent?: boolean;
}> = ({ text = 'Loading...', transparent = false }) => (
  <div className={`loading-overlay ${transparent ? 'transparent' : ''}`}>
    <div className="loading-overlay-content">
      <LoadingIndicator size="large" variant="spinner" />
      <span className="loading-overlay-text">{text}</span>
    </div>
  </div>
);

/**
 * Skeleton placeholder for content loading
 */
export const Skeleton: React.FC<{
  width?: string | number;
  height?: string | number;
  variant?: 'text' | 'rectangular' | 'circular';
  className?: string;
}> = ({ width = '100%', height = 20, variant = 'text', className = '' }) => (
  <div
    className={`loading-skeleton skeleton-${variant} ${className}`}
    style={{ width, height }}
    aria-hidden="true"
  />
);

export default LoadingIndicator;
