/**
 * Atlas Desktop - Palantir-Style Orb Widget
 * Wraps the AsciiOrb with the widget interactions and layout
 */
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AsciiOrb } from './AsciiOrb'; // Import the new ASCII implementation
import './OrbWidget.css';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export interface OrbWidgetProps {
  state?: OrbState;
  audioLevel?: number; // 0-1 for voice reactivity
  statusText?: string;
  onOrbClick?: () => void;
  onExpandClick?: () => void;
  size?: 'compact' | 'medium';
}

const STATE_CONFIG: Record<OrbState, { label: string }> = {
  idle: { label: 'System Ready' },
  listening: { label: 'Listening...' },
  thinking: { label: 'Processing...' },
  speaking: { label: 'Transmitting' },
  error: { label: 'System Error' },
};

export const OrbWidget: React.FC<OrbWidgetProps> = ({
  state = 'idle',
  audioLevel = 0,
  statusText,
  onOrbClick,
  onExpandClick,
  size = 'compact',
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const config = STATE_CONFIG[state] || STATE_CONFIG.idle;
  const displayText = statusText || config.label;
  
  // Decide size in pixels for the canvas
  const orbSizePx = size === 'compact' ? 120 : 250; 

  return (
    <div 
      className={`pt-orb-widget pt-orb-${size} pt-orb-${state}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onOrbClick}
    >
      <div className="pt-orb-container">
        {/* Replaced canvas logic with AsciiOrb */}
        <AsciiOrb 
          state={state} 
          audioLevel={audioLevel}
          size={orbSizePx} 
        />
        
        {/* CRT Scanline overlay handled by CSS in App or Widget */}
        <div className="pt-orb-scanlines"></div>
      </div>
      
      {/* Status Text with Palantir brackets */}
      <div className="pt-orb-status-line">
        <span className="pt-icon-bracket">[</span>
        <AnimatePresence mode="wait">
          <motion.span
            key={displayText}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pt-status-text"
          >
            {displayText}
          </motion.span>
        </AnimatePresence>
        <span className="pt-icon-bracket">]</span>
      </div>

      {/* Expand Button */}
      {onExpandClick && (
        <motion.button
          className="pt-orb-expand-btn"
          onClick={(e) => {
            e.stopPropagation();
            onExpandClick();
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: isHovered ? 1 : 0 }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
           <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M1 1h4v1.5H2.5V5H1V1zM9 1h4v4h-1.5V2.5H9V1zM1 9h1.5v2.5H5V13H1V9zM9 11.5V13h4V9h-1.5v2.5H9z"/>
          </svg>
        </motion.button>
      )}
    </div>
  );
};
