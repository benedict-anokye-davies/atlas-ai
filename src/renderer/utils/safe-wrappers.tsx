/**
 * Atlas Desktop - Safe Component Wrappers
 * Error-boundary wrapped versions of risky components
 */

import React, { Suspense, ReactNode, ComponentType } from 'react';
import { ErrorBoundary, OrbErrorBoundary } from './error-boundary';

// ============================================================================
// Loading Fallbacks
// ============================================================================

/**
 * Simple loading spinner
 */
export const LoadingSpinner: React.FC<{ size?: number; color?: string }> = ({
  size = 24,
  color = '#00D4FF',
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
      minHeight: 60,
    }}
  >
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{
        animation: 'spin 1s linear infinite',
      }}
    >
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke={color}
        strokeWidth="2"
        fill="none"
        strokeDasharray="31.4"
        strokeDashoffset="10"
        strokeLinecap="round"
      />
    </svg>
  </div>
);

/**
 * Placeholder component for when something fails to load
 */
export const ComponentPlaceholder: React.FC<{
  name?: string;
  height?: number | string;
}> = ({ name = 'Component', height = 100 }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height,
      backgroundColor: 'rgba(255, 255, 255, 0.02)',
      borderRadius: 8,
      border: '1px solid rgba(255, 255, 255, 0.05)',
      color: '#6b7280',
      fontSize: 13,
    }}
  >
    {name} unavailable
  </div>
);

// ============================================================================
// Safe Wrapper HOC
// ============================================================================

interface SafeWrapperOptions {
  /** Name for error reporting */
  name?: string;
  /** Fallback when error occurs */
  errorFallback?: ReactNode;
  /** Fallback when loading (for Suspense) */
  loadingFallback?: ReactNode;
  /** Whether to use Suspense */
  useSuspense?: boolean;
  /** Callback when error occurs */
  onError?: (error: Error) => void;
}

/**
 * Higher-order component that wraps a component with error boundary and optional suspense
 */
export function withSafeWrapper<P extends object>(
  WrappedComponent: ComponentType<P>,
  options: SafeWrapperOptions = {}
): React.FC<P> {
  const {
    name = WrappedComponent.displayName || WrappedComponent.name || 'Component',
    errorFallback,
    loadingFallback = <LoadingSpinner />,
    useSuspense = false,
    onError,
  } = options;

  const SafeWrapper: React.FC<P> = (props) => {
    const fallback = errorFallback || <ComponentPlaceholder name={name} />;

    const content = useSuspense ? (
      <Suspense fallback={loadingFallback}>
        <WrappedComponent {...props} />
      </Suspense>
    ) : (
      <WrappedComponent {...props} />
    );

    return (
      <ErrorBoundary
        name={name}
        fallback={fallback}
        onError={(error) => {
          console.error(`[SafeWrapper] ${name} crashed:`, error);
          onError?.(error);
        }}
      >
        {content}
      </ErrorBoundary>
    );
  };

  SafeWrapper.displayName = `Safe(${name})`;

  return SafeWrapper;
}

// ============================================================================
// Canvas-Specific Safe Wrapper
// ============================================================================

interface SafeCanvasWrapperProps {
  children: ReactNode;
  name?: string;
  height?: number | string;
  width?: number | string;
}

/**
 * Safe wrapper specifically for canvas-based components
 * Handles WebGL/Canvas context failures gracefully
 */
export const SafeCanvasWrapper: React.FC<SafeCanvasWrapperProps> = ({
  children,
  name = 'Canvas',
  height = '100%',
  width = '100%',
}) => {
  const fallback = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width,
        height,
        backgroundColor: '#0a0a0f',
        borderRadius: 8,
        color: '#6b7280',
        fontSize: 13,
        textAlign: 'center',
        padding: 16,
      }}
    >
      <div>
        <div style={{ marginBottom: 8 }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="#4b5563">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
          </svg>
        </div>
        {name} visualization unavailable
      </div>
    </div>
  );

  return (
    <ErrorBoundary
      name={`Canvas:${name}`}
      fallback={fallback}
      onError={(error) => {
        console.warn(`[SafeCanvasWrapper] ${name} failed:`, error.message);
      }}
    >
      {children}
    </ErrorBoundary>
  );
};

// ============================================================================
// Safe Orb Wrapper (uses specialized orb error boundary)
// ============================================================================

interface SafeOrbWrapperProps {
  children: ReactNode;
  onError?: (error: Error) => void;
}

/**
 * Safe wrapper for Orb visualization components
 */
export const SafeOrbWrapper: React.FC<SafeOrbWrapperProps> = ({ children, onError }) => {
  return (
    <OrbErrorBoundary onError={onError}>
      {children}
    </OrbErrorBoundary>
  );
};

// ============================================================================
// Safe Widget Wrapper
// ============================================================================

interface SafeWidgetWrapperProps {
  children: ReactNode;
  name: string;
  minHeight?: number;
}

/**
 * Safe wrapper for dashboard widgets
 */
export const SafeWidgetWrapper: React.FC<SafeWidgetWrapperProps> = ({
  children,
  name,
  minHeight = 100,
}) => {
  const fallback = (
    <div
      className="pt-widget pt-widget--error"
      style={{
        minHeight,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255, 68, 68, 0.05)',
        borderRadius: 8,
        border: '1px solid rgba(255, 68, 68, 0.2)',
        color: '#9ca3af',
        fontSize: 13,
      }}
    >
      <span>{name} widget error</span>
    </div>
  );

  return (
    <ErrorBoundary
      name={`Widget:${name}`}
      fallback={fallback}
      onError={(error) => {
        console.warn(`[SafeWidgetWrapper] ${name} failed:`, error.message);
      }}
    >
      {children}
    </ErrorBoundary>
  );
};

// ============================================================================
// Safe Modal Wrapper
// ============================================================================

interface SafeModalWrapperProps {
  children: ReactNode;
  name: string;
  onClose?: () => void;
}

/**
 * Safe wrapper for modal components
 */
export const SafeModalWrapper: React.FC<SafeModalWrapperProps> = ({
  children,
  name,
  onClose,
}) => {
  const fallback = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        zIndex: 9999,
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          padding: 32,
          borderRadius: 12,
          textAlign: 'center',
          maxWidth: 400,
        }}
      >
        <h3 style={{ color: '#f3f4f6', margin: '0 0 12px 0' }}>
          {name} Error
        </h3>
        <p style={{ color: '#9ca3af', margin: '0 0 16px 0' }}>
          Something went wrong. Please try again.
        </p>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        )}
      </div>
    </div>
  );

  return (
    <ErrorBoundary name={`Modal:${name}`} fallback={fallback}>
      {children}
    </ErrorBoundary>
  );
};

// ============================================================================
// Export All
// ============================================================================

// Components are exported inline (export const) above
