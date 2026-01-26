/**
 * Atlas Desktop - Palantir-Style App Shell Layout
 * Command Center Layout with Header, Navigation, Main Content, and Context Panel
 */
import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import '../../styles/palantir-theme.css';
import './AppShell.css';

export interface AppShellProps {
  children: React.ReactNode;
  header?: React.ReactNode;
  leftNav?: React.ReactNode;
  contextPanel?: React.ReactNode;
  statusBar?: React.ReactNode;
  showContextPanel?: boolean;
  onContextPanelToggle?: (show: boolean) => void;
}

export const AppShell: React.FC<AppShellProps> = ({
  children,
  header,
  leftNav,
  contextPanel,
  statusBar,
  showContextPanel = false,
  onContextPanelToggle,
}) => {
  const [isNavExpanded, setIsNavExpanded] = useState(false);
  const [isContextVisible, setIsContextVisible] = useState(showContextPanel);

  // Sync external state
  useEffect(() => {
    setIsContextVisible(showContextPanel);
  }, [showContextPanel]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + \ to toggle context panel
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        const newState = !isContextVisible;
        setIsContextVisible(newState);
        onContextPanelToggle?.(newState);
      }
      // Cmd/Ctrl + B to toggle left nav
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setIsNavExpanded(!isNavExpanded);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isContextVisible, isNavExpanded, onContextPanelToggle]);

  const handleNavMouseEnter = useCallback(() => {
    setIsNavExpanded(true);
  }, []);

  const handleNavMouseLeave = useCallback(() => {
    setIsNavExpanded(false);
  }, []);

  const toggleContextPanel = useCallback(() => {
    const newState = !isContextVisible;
    setIsContextVisible(newState);
    onContextPanelToggle?.(newState);
  }, [isContextVisible, onContextPanelToggle]);

  return (
    <div className="atlas-shell">
      {/* Header Bar */}
      {header && <div className="atlas-shell-header">{header}</div>}

      {/* Main Body */}
      <div className="atlas-shell-body">
        {/* Left Navigation */}
        {leftNav && (
          <motion.nav
            className="atlas-shell-nav"
            onMouseEnter={handleNavMouseEnter}
            onMouseLeave={handleNavMouseLeave}
            animate={{
              width: isNavExpanded ? 'var(--atlas-left-nav-expanded)' : 'var(--atlas-left-nav-collapsed)',
            }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            {leftNav}
          </motion.nav>
        )}

        {/* Main Content Area */}
        <main className="atlas-shell-main">
          {children}
        </main>

        {/* Context Panel */}
        <AnimatePresence>
          {contextPanel && isContextVisible && (
            <motion.aside
              className="atlas-shell-context"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'var(--atlas-context-panel-width)', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
            >
              {contextPanel}
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Context Panel Toggle Button */}
        {contextPanel && (
          <button
            className={`atlas-shell-context-toggle ${isContextVisible ? 'active' : ''}`}
            onClick={toggleContextPanel}
            title={isContextVisible ? 'Hide context panel (Ctrl+\\)' : 'Show context panel (Ctrl+\\)'}
            aria-label={isContextVisible ? 'Hide context panel' : 'Show context panel'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              {isContextVisible ? (
                <path d="M10 3L5 8l5 5V3z" />
              ) : (
                <path d="M6 3l5 5-5 5V3z" />
              )}
            </svg>
          </button>
        )}
      </div>

      {/* Status Bar */}
      {statusBar && <div className="atlas-shell-status">{statusBar}</div>}
    </div>
  );
};

export default AppShell;
