/**
 * Atlas Desktop - Boot Screen Component
 * Cyberpunk-style initialization sequence animation
 */
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TypewriterText, GlitchText, DataStream } from './effects';
import './BootScreen.css';

export interface BootScreenProps {
  onComplete?: () => void;
  skipDelay?: number; // ms to allow skip
  debugMode?: boolean;
}

interface BootMessage {
  id: string;
  text: string;
  status: 'pending' | 'running' | 'success' | 'warning' | 'error';
  delay: number;
}

const BOOT_SEQUENCE: BootMessage[] = [
  { id: 'init', text: 'Initializing Atlas Core...', status: 'pending', delay: 300 },
  { id: 'neural', text: 'Loading neural pathways...', status: 'pending', delay: 400 },
  { id: 'voice', text: 'Activating voice pipeline...', status: 'pending', delay: 350 },
  { id: 'memory', text: 'Mounting memory banks...', status: 'pending', delay: 300 },
  { id: 'tools', text: 'Registering 60+ agent tools...', status: 'pending', delay: 400 },
  { id: 'browser', text: 'Spawning browser agent...', status: 'pending', delay: 350 },
  { id: 'trading', text: 'Connecting trading systems...', status: 'pending', delay: 400 },
  { id: 'secure', text: 'Establishing secure channels...', status: 'pending', delay: 300 },
  { id: 'ready', text: 'ATLAS ONLINE', status: 'pending', delay: 500 },
];

export const BootScreen: React.FC<BootScreenProps> = ({
  onComplete,
  skipDelay = 1500,
  debugMode = false,
}) => {
  const [messages, setMessages] = useState<BootMessage[]>(BOOT_SEQUENCE);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [canSkip, setCanSkip] = useState(false);
  const [progress, setProgress] = useState(0);

  // Allow skip after initial delay
  useEffect(() => {
    const timer = setTimeout(() => setCanSkip(true), skipDelay);
    return () => clearTimeout(timer);
  }, [skipDelay]);

  // Run boot sequence
  useEffect(() => {
    if (currentIndex >= messages.length) {
      setTimeout(() => {
        setIsComplete(true);
        setTimeout(() => onComplete?.(), 800);
      }, 600);
      return;
    }

    const msg = messages[currentIndex];
    
    // Set to running
    setMessages(prev => prev.map((m, i) => 
      i === currentIndex ? { ...m, status: 'running' } : m
    ));

    // Complete after delay
    const timer = setTimeout(() => {
      setMessages(prev => prev.map((m, i) => 
        i === currentIndex ? { ...m, status: 'success' } : m
      ));
      setProgress(((currentIndex + 1) / messages.length) * 100);
      setCurrentIndex(prev => prev + 1);
    }, msg.delay + (debugMode ? 500 : 0));

    return () => clearTimeout(timer);
  }, [currentIndex, messages.length, debugMode, onComplete]);

  const handleSkip = useCallback(() => {
    if (canSkip && !isComplete) {
      setIsComplete(true);
      onComplete?.();
    }
  }, [canSkip, isComplete, onComplete]);

  // Handle click or keypress to skip
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        handleSkip();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleSkip]);

  return (
    <AnimatePresence>
      {!isComplete && (
        <motion.div 
          className="boot-screen"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
          onClick={handleSkip}
        >
          {/* Background Data Stream */}
          <div className="boot-screen__background">
            <DataStream density={15} speed={20} />
          </div>

          {/* Vignette overlay */}
          <div className="boot-screen__vignette" />

          {/* Content */}
          <div className="boot-screen__content">
            {/* Logo */}
            <motion.div 
              className="boot-screen__logo"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
            >
              <AtlasBootLogo />
              <h1 className="boot-screen__title">
                <GlitchText text="ATLAS" glitchIntensity="medium" />
              </h1>
              <p className="boot-screen__subtitle">AI Desktop Assistant</p>
            </motion.div>

            {/* Boot Messages */}
            <div className="boot-screen__messages">
              {messages.map((msg, index) => (
                <motion.div
                  key={msg.id}
                  className={`boot-message boot-message--${msg.status}`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ 
                    opacity: index <= currentIndex ? 1 : 0.3,
                    x: 0 
                  }}
                  transition={{ duration: 0.2, delay: index * 0.05 }}
                >
                  <span className="boot-message__status">
                    {msg.status === 'running' && <span className="boot-message__spinner">⟳</span>}
                    {msg.status === 'success' && <span className="boot-message__check">✓</span>}
                    {msg.status === 'warning' && <span className="boot-message__warn">!</span>}
                    {msg.status === 'error' && <span className="boot-message__error">✗</span>}
                    {msg.status === 'pending' && <span className="boot-message__pending">○</span>}
                  </span>
                  <span className="boot-message__text">
                    {msg.status === 'running' ? (
                      <TypewriterText 
                        text={msg.text} 
                        speed={30} 
                        cursor={true}
                      />
                    ) : (
                      msg.text
                    )}
                  </span>
                  {msg.status === 'success' && (
                    <span className="boot-message__time">
                      {msg.delay}ms
                    </span>
                  )}
                </motion.div>
              ))}
            </div>

            {/* Progress Bar */}
            <div className="boot-screen__progress">
              <div className="boot-screen__progress-track">
                <motion.div 
                  className="boot-screen__progress-fill"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <span className="boot-screen__progress-text">
                {Math.round(progress)}%
              </span>
            </div>

            {/* Skip Hint */}
            <motion.p 
              className="boot-screen__skip"
              initial={{ opacity: 0 }}
              animate={{ opacity: canSkip ? 0.5 : 0 }}
              transition={{ duration: 0.3 }}
            >
              Press any key or click to skip
            </motion.p>
          </div>

          {/* Scan lines */}
          <div className="boot-screen__scanlines" />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// Boot screen logo - Animated version
const AtlasBootLogo: React.FC = () => (
  <svg 
    className="boot-logo-svg"
    width="80" 
    height="80" 
    viewBox="0 0 24 24" 
    fill="none"
  >
    <defs>
      <linearGradient id="boot-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="var(--atlas-cyan)" />
        <stop offset="100%" stopColor="var(--atlas-green)" />
      </linearGradient>
      <filter id="boot-glow">
        <feGaussianBlur stdDeviation="2" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    
    {/* Outer ring */}
    <circle 
      className="boot-logo__ring boot-logo__ring--outer"
      cx="12" 
      cy="12" 
      r="10" 
      stroke="url(#boot-gradient)" 
      strokeWidth="1" 
      fill="none"
      strokeDasharray="62.83"
      strokeDashoffset="62.83"
      filter="url(#boot-glow)"
    />
    
    {/* Middle ring */}
    <circle 
      className="boot-logo__ring boot-logo__ring--middle"
      cx="12" 
      cy="12" 
      r="7" 
      stroke="url(#boot-gradient)" 
      strokeWidth="0.5" 
      fill="none"
      strokeDasharray="44"
      strokeDashoffset="44"
      opacity="0.6"
    />
    
    {/* Inner core */}
    <circle 
      className="boot-logo__core"
      cx="12" 
      cy="12" 
      r="3" 
      fill="url(#boot-gradient)"
      filter="url(#boot-glow)"
    />
    
    {/* Crosshairs */}
    <g className="boot-logo__crosshairs" opacity="0">
      <line x1="12" y1="2" x2="12" y2="6" stroke="url(#boot-gradient)" strokeWidth="1" />
      <line x1="12" y1="18" x2="12" y2="22" stroke="url(#boot-gradient)" strokeWidth="1" />
      <line x1="2" y1="12" x2="6" y2="12" stroke="url(#boot-gradient)" strokeWidth="1" />
      <line x1="18" y1="12" x2="22" y2="12" stroke="url(#boot-gradient)" strokeWidth="1" />
    </g>
  </svg>
);

export default BootScreen;
