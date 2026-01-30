/**
 * Atlas Desktop - React Entry Point
 * Modern AI Chat Interface
 * 
 * This is the bulletproof entry point with:
 * - Global error handlers for unhandled rejections
 * - App-level error boundary wrapping entire React tree
 * - Graceful fallbacks when things go wrong
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { SparkApp } from './components/spark';
import { AppErrorBoundary } from './utils/error-boundary';
import { installGlobalErrorHandlers } from './utils/stability';
import './styles/index.css';
import './components/spark/spark-styles.css';

// ============================================================================
// Install Global Error Handlers FIRST (before React mounts)
// ============================================================================

installGlobalErrorHandlers();

// ============================================================================
// Safe DOM Ready Check
// ============================================================================

function mountApp(): void {
  const root = document.getElementById('root');

  if (!root) {
    // Create fallback root if missing (shouldn't happen, but bulletproof)
    console.error('[Atlas] Root element not found, creating fallback');
    const fallbackRoot = document.createElement('div');
    fallbackRoot.id = 'root';
    document.body.appendChild(fallbackRoot);
    mountToElement(fallbackRoot);
    return;
  }

  mountToElement(root);
}

function mountToElement(element: HTMLElement): void {
  try {
    const reactRoot = ReactDOM.createRoot(element);

    reactRoot.render(
      <React.StrictMode>
        <AppErrorBoundary>
          <SparkApp />
        </AppErrorBoundary>
      </React.StrictMode>
    );

    console.log('[Atlas] Application mounted successfully');
  } catch (err) {
    // Ultimate fallback if React fails to mount
    console.error('[Atlas] Failed to mount React application:', err);
    element.innerHTML = `
      <div style="
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        background: #0a0a0f;
        color: #e5e7eb;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        text-align: center;
        padding: 32px;
      ">
        <div>
          <h1 style="font-size: 24px; margin-bottom: 16px; color: #ef4444;">
            Atlas Failed to Start
          </h1>
          <p style="color: #9ca3af; margin-bottom: 24px;">
            The application encountered a critical error during startup.
          </p>
          <button 
            onclick="window.location.reload()" 
            style="
              padding: 12px 24px;
              background: #3b82f6;
              color: white;
              border: none;
              border-radius: 8px;
              cursor: pointer;
              font-size: 14px;
            "
          >
            Reload Application
          </button>
        </div>
      </div>
    `;
  }
}

// ============================================================================
// Mount the Application
// ============================================================================

// Ensure DOM is ready before mounting
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountApp);
} else {
  mountApp();
}
