/**
 * Atlas Desktop - React Error Boundary
 * Catches and handles React component errors with recovery options
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Error information captured by the boundary
 */
export interface ErrorBoundaryError {
  error: Error;
  errorInfo: ErrorInfo;
  timestamp: number;
  componentStack: string;
}

/**
 * Props for ErrorBoundary component
 */
export interface ErrorBoundaryProps {
  /** Child components to wrap */
  children: ReactNode;
  /** Custom fallback component */
  fallback?: ReactNode | ((props: ErrorFallbackProps) => ReactNode);
  /** Called when an error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Called when reset is triggered */
  onReset?: () => void;
  /** Keys that trigger reset when changed */
  resetKeys?: unknown[];
  /** Whether to log errors to the main process */
  logToMain?: boolean;
  /** Component name for identification */
  name?: string;
}

/**
 * Props passed to fallback component
 */
export interface ErrorFallbackProps {
  error: Error;
  errorInfo: ErrorInfo;
  resetError: () => void;
}

/**
 * State for ErrorBoundary
 */
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorCount: number;
}

// ============================================================================
// Error Boundary Component
// ============================================================================

/**
 * ErrorBoundary - Catches React errors and displays fallback UI
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Update state with error info
    this.setState((prevState) => ({
      errorInfo,
      errorCount: prevState.errorCount + 1,
    }));

    // Log to console
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);

    // Log to main process if enabled
    if (this.props.logToMain !== false) {
      this.logToMainProcess(error, errorInfo);
    }

    // Call error callback
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    // Check if resetKeys changed to trigger automatic reset
    if (
      this.state.hasError &&
      this.props.resetKeys &&
      prevProps.resetKeys &&
      !this.arraysAreEqual(prevProps.resetKeys, this.props.resetKeys)
    ) {
      this.resetError();
    }
  }

  /**
   * Log error to main process via IPC
   */
  private logToMainProcess(error: Error, errorInfo: ErrorInfo): void {
    try {
      const name = this.props.name || 'Unknown';
      window.atlas?.log?.('error', `ErrorBoundary:${name}`, error.message, {
        name: error.name,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
      });
    } catch {
      // Ignore logging errors
    }
  }

  /**
   * Compare two arrays for equality
   */
  private arraysAreEqual(a: unknown[], b: unknown[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  /**
   * Reset the error state
   */
  resetError = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });

    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      // Render fallback UI
      const { fallback } = this.props;
      const { error, errorInfo } = this.state;

      if (typeof fallback === 'function') {
        return fallback({
          error,
          errorInfo: errorInfo!,
          resetError: this.resetError,
        });
      }

      if (fallback) {
        return fallback;
      }

      // Default fallback UI
      return (
        <DefaultErrorFallback
          error={error}
          errorInfo={errorInfo!}
          resetError={this.resetError}
        />
      );
    }

    return this.props.children;
  }
}

// ============================================================================
// Default Fallback Component
// ============================================================================

/**
 * Default error fallback UI
 */
function DefaultErrorFallback({
  error,
  errorInfo,
  resetError,
}: ErrorFallbackProps): JSX.Element {
  const [showDetails, setShowDetails] = React.useState(false);

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <div style={styles.iconContainer}>
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ef4444"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        <h2 style={styles.title}>Something went wrong</h2>

        <p style={styles.message}>{error.message || 'An unexpected error occurred'}</p>

        <div style={styles.buttonContainer}>
          <button onClick={resetError} style={styles.primaryButton}>
            Try Again
          </button>

          <button
            onClick={() => setShowDetails(!showDetails)}
            style={styles.secondaryButton}
          >
            {showDetails ? 'Hide Details' : 'Show Details'}
          </button>

          <button onClick={() => window.location.reload()} style={styles.secondaryButton}>
            Reload Page
          </button>
        </div>

        {showDetails && (
          <div style={styles.detailsContainer}>
            <div style={styles.detailsSection}>
              <h4 style={styles.detailsTitle}>Error</h4>
              <pre style={styles.detailsCode}>
                {error.name}: {error.message}
                {error.stack && `\n\n${error.stack}`}
              </pre>
            </div>

            {errorInfo && (
              <div style={styles.detailsSection}>
                <h4 style={styles.detailsTitle}>Component Stack</h4>
                <pre style={styles.detailsCode}>{errorInfo.componentStack}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '24px',
    backgroundColor: '#0a0a0f',
    color: '#e5e7eb',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  content: {
    maxWidth: '600px',
    textAlign: 'center' as const,
  },
  iconContainer: {
    marginBottom: '24px',
  },
  title: {
    fontSize: '24px',
    fontWeight: '600',
    margin: '0 0 12px 0',
    color: '#f3f4f6',
  },
  message: {
    fontSize: '16px',
    color: '#9ca3af',
    margin: '0 0 24px 0',
    lineHeight: '1.5',
  },
  buttonContainer: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
    flexWrap: 'wrap' as const,
  },
  primaryButton: {
    padding: '12px 24px',
    fontSize: '14px',
    fontWeight: '500',
    color: '#ffffff',
    backgroundColor: '#3b82f6',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  secondaryButton: {
    padding: '12px 24px',
    fontSize: '14px',
    fontWeight: '500',
    color: '#9ca3af',
    backgroundColor: 'transparent',
    border: '1px solid #374151',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  detailsContainer: {
    marginTop: '24px',
    textAlign: 'left' as const,
  },
  detailsSection: {
    marginBottom: '16px',
  },
  detailsTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#9ca3af',
    margin: '0 0 8px 0',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  detailsCode: {
    padding: '12px',
    fontSize: '12px',
    lineHeight: '1.5',
    color: '#d1d5db',
    backgroundColor: '#1f2937',
    borderRadius: '6px',
    overflow: 'auto',
    maxHeight: '200px',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    margin: 0,
  },
};

// ============================================================================
// Specialized Error Boundaries
// ============================================================================

/**
 * Error boundary for the Orb visualization
 */
export function OrbErrorBoundary({
  children,
  onError,
}: {
  children: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}): JSX.Element {
  return (
    <ErrorBoundary
      name="Orb"
      onError={onError}
      fallback={({ resetError }) => (
        <div style={orbFallbackStyles.container}>
          <div style={orbFallbackStyles.content}>
            <p style={orbFallbackStyles.message}>Visualization error</p>
            <button onClick={resetError} style={orbFallbackStyles.button}>
              Retry
            </button>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

const orbFallbackStyles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(10, 10, 15, 0.8)',
    borderRadius: '50%',
  },
  content: {
    textAlign: 'center' as const,
  },
  message: {
    fontSize: '14px',
    color: '#9ca3af',
    margin: '0 0 12px 0',
  },
  button: {
    padding: '8px 16px',
    fontSize: '12px',
    color: '#ffffff',
    backgroundColor: '#3b82f6',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
};

/**
 * Error boundary for Settings panel
 */
export function SettingsErrorBoundary({
  children,
  onError,
}: {
  children: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}): JSX.Element {
  return (
    <ErrorBoundary
      name="Settings"
      onError={onError}
      fallback={({ error, resetError }) => (
        <div style={settingsFallbackStyles.container}>
          <h3 style={settingsFallbackStyles.title}>Settings Error</h3>
          <p style={settingsFallbackStyles.message}>{error.message}</p>
          <button onClick={resetError} style={settingsFallbackStyles.button}>
            Retry
          </button>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

const settingsFallbackStyles: Record<string, React.CSSProperties> = {
  container: {
    padding: '24px',
    textAlign: 'center' as const,
  },
  title: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#f3f4f6',
    margin: '0 0 8px 0',
  },
  message: {
    fontSize: '14px',
    color: '#9ca3af',
    margin: '0 0 16px 0',
  },
  button: {
    padding: '10px 20px',
    fontSize: '14px',
    color: '#ffffff',
    backgroundColor: '#3b82f6',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
};

// ============================================================================
// HOC for wrapping components with error boundary
// ============================================================================

/**
 * Higher-order component to wrap any component with error boundary
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options: Omit<ErrorBoundaryProps, 'children'> = {}
): React.FC<P> {
  const displayName = WrappedComponent.displayName || WrappedComponent.name || 'Component';

  const WithErrorBoundary: React.FC<P> = (props) => (
    <ErrorBoundary name={displayName} {...options}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  );

  WithErrorBoundary.displayName = `withErrorBoundary(${displayName})`;

  return WithErrorBoundary;
}

// ============================================================================
// Hook for error reporting
// ============================================================================

/**
 * Hook to report errors from functional components
 */
export function useErrorReporter(): {
  reportError: (error: Error, context?: Record<string, unknown>) => void;
} {
  const reportError = React.useCallback(
    (error: Error, context?: Record<string, unknown>) => {
      console.error('[useErrorReporter] Error:', error);

      try {
        window.atlas?.log?.('error', 'ComponentError', error.message, {
          name: error.name,
          stack: error.stack,
          ...context,
        });
      } catch {
        // Ignore logging errors
      }
    },
    []
  );

  return { reportError };
}

// ============================================================================
// App-level Error Boundary
// ============================================================================

/**
 * Top-level error boundary for the entire application
 */
export function AppErrorBoundary({ children }: { children: ReactNode }): JSX.Element {
  const handleError = React.useCallback((error: Error, errorInfo: ErrorInfo) => {
    // Log to main process
    try {
      window.atlas?.log?.('error', 'AppCrash', 'React application crashed', {
        error: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
      });
    } catch {
      // Ignore logging errors
    }
  }, []);

  const handleReset = React.useCallback(() => {
    // Clear any cached state that might cause the error
    try {
      sessionStorage.clear();
    } catch {
      // Ignore storage errors
    }
  }, []);

  return (
    <ErrorBoundary
      name="App"
      onError={handleError}
      onReset={handleReset}
      logToMain={true}
      fallback={({ error, resetError }) => (
        <div style={appFallbackStyles.container}>
          <div style={appFallbackStyles.content}>
            <div style={appFallbackStyles.iconContainer}>
              <svg
                width="64"
                height="64"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ef4444"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>

            <h1 style={appFallbackStyles.title}>Atlas Encountered an Error</h1>

            <p style={appFallbackStyles.message}>
              We apologize for the inconvenience. The application encountered an unexpected error.
            </p>

            <p style={appFallbackStyles.errorMessage}>{error.message}</p>

            <div style={appFallbackStyles.buttonContainer}>
              <button onClick={resetError} style={appFallbackStyles.primaryButton}>
                Try Again
              </button>

              <button
                onClick={() => window.location.reload()}
                style={appFallbackStyles.secondaryButton}
              >
                Reload Application
              </button>
            </div>

            <p style={appFallbackStyles.helpText}>
              If this problem persists, please restart the application or check the logs in
              ~/.atlas/logs/
            </p>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

const appFallbackStyles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '32px',
    backgroundColor: '#0a0a0f',
    color: '#e5e7eb',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  content: {
    maxWidth: '500px',
    textAlign: 'center' as const,
  },
  iconContainer: {
    marginBottom: '24px',
  },
  title: {
    fontSize: '28px',
    fontWeight: '600',
    margin: '0 0 16px 0',
    color: '#f3f4f6',
  },
  message: {
    fontSize: '16px',
    color: '#9ca3af',
    margin: '0 0 16px 0',
    lineHeight: '1.6',
  },
  errorMessage: {
    fontSize: '14px',
    color: '#ef4444',
    margin: '0 0 24px 0',
    padding: '12px',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: '8px',
    fontFamily: 'monospace',
    wordBreak: 'break-word' as const,
  },
  buttonContainer: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
    marginBottom: '24px',
  },
  primaryButton: {
    padding: '14px 28px',
    fontSize: '16px',
    fontWeight: '500',
    color: '#ffffff',
    backgroundColor: '#3b82f6',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  secondaryButton: {
    padding: '14px 28px',
    fontSize: '16px',
    fontWeight: '500',
    color: '#9ca3af',
    backgroundColor: 'transparent',
    border: '1px solid #374151',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  helpText: {
    fontSize: '13px',
    color: '#6b7280',
    margin: 0,
  },
};

export default ErrorBoundary;
