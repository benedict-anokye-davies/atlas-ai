/**
 * Atlas Desktop - Modern Chat App
 * Standalone chat interface entry point
 * 
 * Use this as an alternative to PalantirApp for a cleaner
 * Claude/Perplexity-style AI chat interface.
 */

import { AccessibilityProvider, ScreenReaderAnnouncer } from './components/accessibility';
import { ErrorBoundary } from './utils/error-boundary';
import { ChatApp } from './components/chat';

export default function ModernChatApp() {
    // Handle navigation to other views
    const handleNavigateToView = (view: string) => {
        console.log('[ModernChatApp] Navigate to:', view);
        // In full implementation, this would switch to the trading/banking views
        // For now, just log the navigation request
    };

    return (
        <ErrorBoundary
            fallback={
                <div style={{
                    minHeight: '100vh',
                    background: '#18181b',
                    color: '#fafafa',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'Inter, sans-serif',
                    padding: '2rem'
                }}>
                    <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Atlas</h1>
                    <p style={{ opacity: 0.7, marginBottom: '2rem' }}>Something went wrong</p>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            background: '#8b5cf6',
                            border: 'none',
                            color: 'white',
                            padding: '0.75rem 2rem',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            fontSize: '0.875rem'
                        }}
                    >
                        Reload
                    </button>
                </div>
            }
        >
            <AccessibilityProvider>
                <ScreenReaderAnnouncer />
                <ChatApp onNavigateToView={handleNavigateToView} />
            </AccessibilityProvider>
        </ErrorBoundary>
    );
}
