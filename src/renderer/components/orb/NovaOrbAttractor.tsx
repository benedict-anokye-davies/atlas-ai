/**
 * Nova Desktop - NovaOrb with Strange Attractor Support
 * Enhanced wrapper for the 3D AI Core with attractor morphing and audio reactivity
 */

import React, { Suspense, useCallback, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { NovaParticlesAttractors } from './NovaParticles_Attractors';
import type { NovaState } from './attractors';
import type { AudioFeatures } from '../../hooks/useAudioAnalysis';

interface NovaOrbAttractorProps {
  state?: NovaState;
  audioFeatures?: AudioFeatures;
  particleCount?: number;
  interactive?: boolean;
  onStateClick?: () => void;
  className?: string;
}

/**
 * Loading fallback for Canvas - wireframe sphere
 */
function OrbLoader() {
  return (
    <mesh>
      <sphereGeometry args={[2, 32, 32]} />
      {/* eslint-disable-next-line react/no-unknown-property */}
      <meshBasicMaterial color="#00d4ff" wireframe transparent opacity={0.3} />
    </mesh>
  );
}

/**
 * Error boundary for WebGL errors
 */
class WebGLErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode; fallback?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[NovaOrbAttractor] WebGL Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ff6666',
              background: '#111',
              borderRadius: '50%',
            }}
          >
            <span>WebGL Error: {this.state.error?.message}</span>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

/**
 * NovaOrb with Strange Attractor Morphing
 * The AI's living, breathing, morphing presence
 */
export function NovaOrbAttractor({
  state = 'idle',
  audioFeatures = { amplitude: 0, bass: 0, treble: 0, pulse: 0 },
  particleCount = 8000,
  interactive = true,
  onStateClick,
  className = '',
}: NovaOrbAttractorProps) {
  const [isHovered, setIsHovered] = useState(false);

  console.log('[NovaOrbAttractor] Rendering', {
    state,
    audioFeatures,
    particleCount,
  });

  const handleClick = useCallback(() => {
    if (onStateClick) {
      onStateClick();
    }
  }, [onStateClick]);

  const handlePointerEnter = useCallback(() => {
    setIsHovered(true);
  }, []);

  const handlePointerLeave = useCallback(() => {
    setIsHovered(false);
  }, []);

  return (
    <div
      className={`nova-orb-container ${className} ${isHovered ? 'hovered' : ''}`}
      onClick={handleClick}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      aria-label={`Nova orb - ${state} state. Click to interact.`}
    >
      <WebGLErrorBoundary>
        <Canvas
          dpr={[1, 2]}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
            stencil: false,
            depth: true,
          }}
          style={{
            background: 'transparent',
            cursor: interactive ? 'pointer' : 'default',
          }}
          onCreated={({ gl }) => {
            console.log('[NovaOrbAttractor] Canvas created');
          }}
        >
          {/* Camera positioned for optimal view */}
          <PerspectiveCamera makeDefault position={[0, 0, 25]} fov={50} near={0.1} far={1000} />

          {/* Ambient light for subtle fill */}
          <ambientLight intensity={0.05} />

          {/* Suspense boundary for async loading */}
          <Suspense fallback={<OrbLoader />}>
            <NovaParticlesAttractors
              state={state}
              audioLevel={audioFeatures.amplitude}
              bass={audioFeatures.bass}
              treble={audioFeatures.treble}
              pulse={audioFeatures.pulse}
              particleCount={particleCount}
            />
          </Suspense>

          {/* Camera controls */}
          {interactive && (
            <OrbitControls
              enableZoom={false}
              enablePan={false}
              autoRotate
              autoRotateSpeed={0.3}
              minPolarAngle={Math.PI / 4}
              maxPolarAngle={Math.PI - Math.PI / 4}
            />
          )}
        </Canvas>
      </WebGLErrorBoundary>

      {/* State indicator overlay */}
      <div className={`orb-state-indicator orb-state-${state}`} />
    </div>
  );
}

export default NovaOrbAttractor;
