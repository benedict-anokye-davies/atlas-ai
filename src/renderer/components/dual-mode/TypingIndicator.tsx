/**
 * @fileoverview Typing Indicator Component
 * Shows animated dots when Atlas is processing
 * Full-width style matching message bubbles
 * 
 * @module TypingIndicator
 */

import React from 'react';
import { MiniOrb } from './MiniOrb';

/**
 * Animated typing indicator with avatar
 */
export const TypingIndicator: React.FC = () => {
  return (
    <div className="typing-indicator" aria-label="Atlas is typing">
      <div className="typing-indicator__avatar">
        <MiniOrb state="thinking" size={20} />
      </div>
      <div className="typing-indicator__dots">
        <div className="typing-indicator__dot" />
        <div className="typing-indicator__dot" />
        <div className="typing-indicator__dot" />
      </div>
    </div>
  );
};

export default TypingIndicator;
