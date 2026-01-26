/**
 * Atlas Desktop - Status Bar Component
 * Bottom bar showing system status, voice state, performance metrics
 */
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './StatusBar.css';

export type ConnectionStatus = 'online' | 'offline' | 'connecting';
export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface StatusBarProps {
  connectionStatus?: ConnectionStatus;
  voiceState?: VoiceState;
  llmProvider?: string;
  cpuUsage?: number;
  memoryUsage?: number;
  fps?: number;
  onStatusClick?: (type: 'connection' | 'voice' | 'performance') => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  connectionStatus = 'online',
  voiceState = 'idle',
  llmProvider = 'Fireworks',
  cpuUsage = 0,
  memoryUsage = 0,
  fps = 60,
  onStatusClick,
}) => {
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update time every second
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-GB', { 
      weekday: 'short', 
      day: 'numeric', 
      month: 'short' 
    });
  };

  const getConnectionLabel = () => {
    switch (connectionStatus) {
      case 'online': return 'Online';
      case 'offline': return 'Offline';
      case 'connecting': return 'Connecting...';
    }
  };

  const getVoiceLabel = () => {
    switch (voiceState) {
      case 'idle': return 'Ready';
      case 'listening': return 'Listening';
      case 'thinking': return 'Processing';
      case 'speaking': return 'Speaking';
    }
  };

  const getPerformanceColor = (value: number, thresholds: [number, number]) => {
    if (value < thresholds[0]) return 'var(--atlas-accent-green)';
    if (value < thresholds[1]) return 'var(--atlas-accent-amber)';
    return 'var(--atlas-accent-red)';
  };

  return (
    <div className="status-bar">
      {/* Left section - Connection & Voice */}
      <div className="status-bar__section status-bar__left">
        {/* Connection status */}
        <button 
          className={`status-bar__item status-bar__connection status-bar__connection--${connectionStatus}`}
          onClick={() => onStatusClick?.('connection')}
        >
          <span className="status-bar__dot" />
          <span className="status-bar__label">{getConnectionLabel()}</span>
        </button>

        {/* Voice state */}
        <button 
          className={`status-bar__item status-bar__voice status-bar__voice--${voiceState}`}
          onClick={() => onStatusClick?.('voice')}
        >
          <span className="status-bar__icon">
            <AnimatePresence mode="wait">
              {voiceState === 'listening' ? (
                <motion.svg
                  key="mic"
                  initial={{ scale: 0.8 }}
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ repeat: Infinity, duration: 1 }}
                  width="12" height="12" viewBox="0 0 20 20" fill="currentColor"
                >
                  <path d="M10 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM7 14v2h6v-2H7zm3-12a5 5 0 0 0-5 5v2a5 5 0 0 0 10 0V7a5 5 0 0 0-5-5z"/>
                </motion.svg>
              ) : voiceState === 'thinking' ? (
                <motion.svg
                  key="thinking"
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                  width="12" height="12" viewBox="0 0 20 20" fill="currentColor"
                >
                  <path d="M10 2a8 8 0 1 0 8 8h-2a6 6 0 1 1-6-6V2z"/>
                </motion.svg>
              ) : (
                <svg key="idle" width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM7 14v2h6v-2H7z"/>
                </svg>
              )}
            </AnimatePresence>
          </span>
          <span className="status-bar__label">{getVoiceLabel()}</span>
        </button>

        {/* LLM Provider */}
        <div className="status-bar__item status-bar__provider">
          <span className="status-bar__icon">
            <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm0 8a4 4 0 0 0-4 4h8a4 4 0 0 0-4-4z"/>
            </svg>
          </span>
          <span className="status-bar__label">{llmProvider}</span>
        </div>
      </div>

      {/* Center section - Alerts/Messages (optional) */}
      <div className="status-bar__section status-bar__center">
        {/* Reserved for transient messages */}
      </div>

      {/* Right section - Performance & Time */}
      <div className="status-bar__section status-bar__right">
        {/* Performance metrics */}
        <button 
          className="status-bar__item status-bar__performance"
          onClick={() => onStatusClick?.('performance')}
        >
          <span 
            className="status-bar__metric"
            style={{ color: getPerformanceColor(cpuUsage, [50, 80]) }}
          >
            CPU {cpuUsage}%
          </span>
          <span className="status-bar__separator">|</span>
          <span 
            className="status-bar__metric"
            style={{ color: getPerformanceColor(memoryUsage, [60, 85]) }}
          >
            RAM {memoryUsage}%
          </span>
          <span className="status-bar__separator">|</span>
          <span 
            className="status-bar__metric"
            style={{ color: fps >= 55 ? 'var(--atlas-accent-green)' : fps >= 30 ? 'var(--atlas-accent-amber)' : 'var(--atlas-accent-red)' }}
          >
            {fps} FPS
          </span>
        </button>

        {/* Date & Time */}
        <div className="status-bar__item status-bar__datetime">
          <span className="status-bar__date">{formatDate(currentTime)}</span>
          <span className="status-bar__time">{formatTime(currentTime)}</span>
        </div>
      </div>
    </div>
  );
};

export default StatusBar;
