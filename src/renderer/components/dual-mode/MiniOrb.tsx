/**
 * @fileoverview Mini Orb Avatar for Chat Mode
 * Animated circular avatar showing Atlas's current state
 * 
 * @module MiniOrb
 */

import React from 'react';
import type { AtlasState } from '../orb/geometry';

// Re-export for convenience
export type OrbState = AtlasState;

interface MiniOrbProps {
  state: OrbState;
  size?: number;
  audioLevel?: number;
  className?: string;
}

/**
 * Mini orb avatar that shows Atlas's current state
 * Used in chat header and message bubbles
 * Pulses with audio level when listening
 */
export const MiniOrb: React.FC<MiniOrbProps> = ({
  state = 'idle',
  size = 36,
  audioLevel = 0,
  className = '',
}) => {
  const stateClass = `mini-orb--${state}`;
  
  // Calculate scale based on audio level when listening
  const audioScale = state === 'listening' 
    ? 1 + (audioLevel * 0.15) // Scale up to 15% with audio
    : 1;
  
  return (
    <div
      className={`mini-orb ${stateClass} ${className}`}
      style={{ 
        width: size, 
        height: size,
        transform: `scale(${audioScale})`,
        transition: 'transform 0.05s ease-out',
      }}
      role="img"
      aria-label={`Atlas is ${state}`}
    >
      <div className="mini-orb__inner" />
    </div>
  );
};

export default MiniOrb;
