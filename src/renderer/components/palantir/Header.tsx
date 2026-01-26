/**
 * Atlas Desktop - Header Bar Component
 * Palantir-style header with app title, view switcher, and controls
 */
import React, { useState, useEffect } from 'react';
import { GlitchText } from './effects';
import './Header.css';

export interface HeaderProps {
  title?: string;
  subtitle?: string;
  viewSwitcher?: React.ReactNode;
  actions?: React.ReactNode;
  searchBar?: React.ReactNode;
  userSection?: React.ReactNode;
  onLogoClick?: () => void;
  connectionStatus?: 'online' | 'offline' | 'degraded';
}

export const Header: React.FC<HeaderProps> = ({
  title = 'ATLAS',
  subtitle,
  viewSwitcher,
  actions,
  searchBar,
  userSection,
  onLogoClick,
  connectionStatus = 'online',
}) => {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-GB', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: false 
    });
  };

  return (
    <header className="atlas-header">
      {/* Left: Logo and Title */}
      <div className="atlas-header-left">
        <button 
          className="atlas-header-logo" 
          onClick={onLogoClick}
          aria-label="Go to home"
        >
          <AtlasLogo />
        </button>
        
        <div className="atlas-header-title-group">
          <h1 className="atlas-header-title">
            <GlitchText text={title} glitchIntensity="low" />
          </h1>
          {subtitle && <span className="atlas-header-subtitle">{subtitle}</span>}
        </div>

        {/* Connection Status Indicator */}
        <div className={`atlas-header-status atlas-header-status--${connectionStatus}`}>
          <span className="atlas-header-status-dot" />
          <span className="atlas-header-status-text">
            {connectionStatus === 'online' ? 'CONNECTED' : connectionStatus === 'degraded' ? 'DEGRADED' : 'OFFLINE'}
          </span>
        </div>

        {viewSwitcher && (
          <div className="atlas-header-divider" />
        )}

        {viewSwitcher && (
          <div className="atlas-header-view-switcher">
            {viewSwitcher}
          </div>
        )}
      </div>

      {/* Center: Search */}
      {searchBar && (
        <div className="atlas-header-center">
          {searchBar}
        </div>
      )}

      {/* Right: Actions and User */}
      <div className="atlas-header-right">
        {actions && (
          <div className="atlas-header-actions">
            {actions}
          </div>
        )}

        {userSection && (
          <div className="atlas-header-user">
            {userSection}
          </div>
        )}

        {/* System Clock - Now in the corner */}
        <div className="atlas-header-clock">
          <span className="atlas-header-clock-time">{formatTime(currentTime)}</span>
          <span className="atlas-header-clock-date">
            {currentTime.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}
          </span>
        </div>
      </div>
    </header>
  );
};

// Atlas Logo SVG - Animated
const AtlasLogo: React.FC = () => (
  <svg 
    className="atlas-logo-svg"
    width="28" 
    height="28" 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="atlas-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="var(--atlas-cyan)" />
        <stop offset="100%" stopColor="var(--atlas-green)" />
      </linearGradient>
      <filter id="atlas-glow">
        <feGaussianBlur stdDeviation="1" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    
    {/* Outer ring */}
    <circle 
      className="atlas-logo-ring"
      cx="12" 
      cy="12" 
      r="10" 
      stroke="url(#atlas-gradient)" 
      strokeWidth="1.5" 
      fill="none" 
      filter="url(#atlas-glow)"
    />
    
    {/* Inner core */}
    <circle 
      className="atlas-logo-core"
      cx="12" 
      cy="12" 
      r="4" 
      fill="url(#atlas-gradient)" 
      opacity="0.9"
      filter="url(#atlas-glow)"
    />
    
    {/* Crosshairs */}
    <path 
      className="atlas-logo-crosshairs"
      d="M12 2 L12 6 M12 18 L12 22 M2 12 L6 12 M18 12 L22 12" 
      stroke="url(#atlas-gradient)" 
      strokeWidth="1.5" 
      strokeLinecap="round"
      opacity="0.7"
    />

    {/* Scanning line */}
    <line 
      className="atlas-logo-scan"
      x1="2" 
      y1="12" 
      x2="22" 
      y2="12" 
      stroke="var(--atlas-cyan)" 
      strokeWidth="0.5"
      opacity="0.5"
    />
  </svg>
);

export default Header;
