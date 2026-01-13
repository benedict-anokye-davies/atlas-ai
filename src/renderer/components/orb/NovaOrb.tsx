/**
 * Nova Desktop - NovaOrb Component
 * Main wrapper for the 3D strange attractor visualization
 */

import { Suspense, useCallback, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { NovaParticles, NovaState } from './NovaParticles';
import { ATTRACTOR_SETTINGS } from './attractors';

interface NovaOrbProps {
  state?: NovaState;
  audioLevel?: number;
  particleCount?: number;
  interactive?: boolean;
  onStateClick?: () => void;
  className?: string;
}

/**
 * Loading fallback for Canvas
 */
function OrbLoader() {
  return (
    <mesh>
      <sphereGeometry args={[2, 32, 32]} />
      <meshBasicMaterial color="#00d4ff" wireframe transparent opacity={0.3} />
    </mesh>
  );
}

/**
 * NovaOrb - The main visual component for Nova
 * Renders a 3D strange attractor particle system that responds to AI state
 */
export function NovaOrb({
  state = 'idle',
  audioLevel = 0,
  particleCount = 35000,
  interactive = true,
  onStateClick,
  className = '',
}: NovaOrbProps) {
  const [isHovered, setIsHovered] = useState(false);
  const settings = ATTRACTOR_SETTINGS.aizawa;

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
      <Canvas
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
        }}
        style={{
          background: 'transparent',
          cursor: interactive ? 'pointer' : 'default',
        }}
      >
        <PerspectiveCamera
          makeDefault
          position={[0, 0, settings.camDistance]}
          fov={50}
          near={0.1}
          far={1000}
        />

        {/* Ambient light for subtle fill */}
        <ambientLight intensity={0.1} />

        {/* Suspense boundary for async loading */}
        <Suspense fallback={<OrbLoader />}>
          <NovaParticles
            state={state}
            audioLevel={audioLevel}
            particleCount={particleCount}
          />
        </Suspense>

        {/* Camera controls */}
        {interactive && (
          <OrbitControls
            enableZoom={false}
            enablePan={false}
            autoRotate
            autoRotateSpeed={0.5}
            minPolarAngle={Math.PI / 4}
            maxPolarAngle={Math.PI - Math.PI / 4}
          />
        )}
      </Canvas>

      {/* State indicator overlay */}
      <div className={`orb-state-indicator orb-state-${state}`} />
    </div>
  );
}

export default NovaOrb;
