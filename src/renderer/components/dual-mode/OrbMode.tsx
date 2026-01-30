/**
 * @fileoverview Orb Mode Component
 * Full-screen immersive orb visualization
 * 
 * @module OrbMode
 */

import React, { Suspense, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import type { AtlasState } from '../orb/geometry';

// Re-export for convenience
export type OrbState = AtlasState;

// Lazy load the heavy particle system
const EnhancedAtlasParticles = React.lazy(() => 
  import('../orb/EnhancedAtlasParticles').then(m => ({ default: m.EnhancedAtlasParticles }))
);

interface OrbModeProps {
  orbState: OrbState;
  audioLevel?: number;
  bass?: number;
  treble?: number;
  currentTranscript?: string;
  onClickOrb?: () => void;
  performanceMode?: 'ultra' | 'high' | 'balanced' | 'power-saver';
}

/**
 * Maps orb state to status indicator color and text
 */
function getStatusInfo(state: OrbState): { text: string; dotClass: string } {
  switch (state) {
    case 'listening':
      return { text: 'Listening...', dotClass: 'orb-mode__status-dot--listening' };
    case 'thinking':
      return { text: 'Thinking...', dotClass: 'orb-mode__status-dot--thinking' };
    case 'speaking':
      return { text: 'Speaking', dotClass: 'orb-mode__status-dot--speaking' };
    case 'error':
      return { text: 'Error', dotClass: 'orb-mode__status-dot--error' };
    default:
      return { text: 'Ready', dotClass: '' };
  }
}

/**
 * Loading fallback for the 3D canvas
 */
function OrbLoading(): JSX.Element {
  return (
    <div 
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(circle at center, #0a1628 0%, #05080a 100%)',
      }}
    >
      <div style={{ 
        width: 100, 
        height: 100, 
        borderRadius: '50%', 
        background: 'linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)',
        animation: 'pulse 2s ease-in-out infinite',
      }} />
    </div>
  );
}

/**
 * Full-screen orb mode with 3D particle visualization
 * Voice-first interface - click orb or say "Hey Atlas"
 */
export const OrbMode: React.FC<OrbModeProps> = ({
  orbState = 'idle',
  audioLevel = 0,
  bass = 0,
  treble = 0,
  currentTranscript,
  onClickOrb,
  performanceMode = 'high',
}) => {
  const { text: statusText, dotClass } = getStatusInfo(orbState);
  
  const handleCanvasClick = useCallback(() => {
    if (onClickOrb && orbState === 'idle') {
      onClickOrb();
    }
  }, [onClickOrb, orbState]);
  
  return (
    <div className="orb-mode">
      {/* 3D Canvas */}
      <div className="orb-mode__canvas" onClick={handleCanvasClick}>
        <Suspense fallback={<OrbLoading />}>
          <Canvas
            camera={{ position: [0, 0, 5], fov: 60 }}
            style={{ background: 'transparent' }}
            gl={{ antialias: true, alpha: true }}
          >
            <EnhancedAtlasParticles
              state={orbState}
              audioLevel={audioLevel}
              bass={bass}
              treble={treble}
              config={{ performanceMode }}
            />
            <ambientLight intensity={0.2} />
          </Canvas>
        </Suspense>
      </div>
      
      {/* Overlay Content */}
      <div className="orb-mode__overlay">
        {/* Click hint when idle */}
        {orbState === 'idle' && (
          <div className="orb-mode__click-hint">
            Say "Hey Atlas" or click to activate
          </div>
        )}
        
        {/* Floating Transcript */}
        {currentTranscript && (
          <div className="orb-mode__transcript">
            <div className="orb-mode__transcript-text">
              {currentTranscript}
            </div>
          </div>
        )}
      </div>
      
      {/* Status Indicator */}
      <div className="orb-mode__status">
        <div className={`orb-mode__status-dot ${dotClass}`} />
        <span>{statusText}</span>
      </div>
    </div>
  );
};

export default OrbMode;
