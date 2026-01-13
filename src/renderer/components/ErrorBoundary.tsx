/**
 * Nova Desktop - Error Boundary
 * React error boundary for catching and displaying renderer errors
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary component to catch React errors
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });

    // Log to main process
    if (window.nova) {
      window.nova.log('error', 'ErrorBoundary', `React Error: ${error.message}`, {
        stack: error.stack,
        componentStack: errorInfo.componentStack,
      });
    }

    // Call custom error handler
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleDismiss = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Custom fallback
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div style={styles.container}>
          <div style={styles.card}>
            <h2 style={styles.title}>Something went wrong</h2>
            <p style={styles.message}>
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            {this.state.errorInfo && (
              <details style={styles.details}>
                <summary style={styles.summary}>Error Details</summary>
                <pre style={styles.stack}>
                  {this.state.error?.stack}
                </pre>
              </details>
            )}
            <div style={styles.actions}>
              <button style={styles.button} onClick={this.handleReload}>
                Reload App
              </button>
              <button style={{ ...styles.button, ...styles.secondaryButton }} onClick={this.handleDismiss}>
                Try Again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Styles
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#0a0a0f',
    padding: '20px',
  },
  card: {
    backgroundColor: '#1a1a24',
    borderRadius: '12px',
    padding: '32px',
    maxWidth: '500px',
    width: '100%',
    border: '1px solid #2a2a3a',
  },
  title: {
    color: '#ff6b6b',
    fontSize: '24px',
    margin: '0 0 16px 0',
    fontWeight: 600,
  },
  message: {
    color: '#a0a0b0',
    fontSize: '16px',
    margin: '0 0 24px 0',
    lineHeight: 1.5,
  },
  details: {
    marginBottom: '24px',
  },
  summary: {
    color: '#6b6b8b',
    cursor: 'pointer',
    fontSize: '14px',
    marginBottom: '12px',
  },
  stack: {
    backgroundColor: '#0f0f14',
    padding: '16px',
    borderRadius: '8px',
    fontSize: '12px',
    color: '#ff8b8b',
    overflow: 'auto',
    maxHeight: '200px',
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  actions: {
    display: 'flex',
    gap: '12px',
  },
  button: {
    flex: 1,
    padding: '12px 24px',
    fontSize: '14px',
    fontWeight: 500,
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    backgroundColor: '#4a9eff',
    color: '#ffffff',
    transition: 'background-color 0.2s',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    border: '1px solid #3a3a4a',
    color: '#a0a0b0',
  },
};

/**
 * HOC to wrap a component with error boundary
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: ReactNode
): React.FC<P> {
  return function WrappedComponent(props: P) {
    return (
      <ErrorBoundary fallback={fallback}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}

export default ErrorBoundary;
