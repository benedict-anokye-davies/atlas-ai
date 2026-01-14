/**
 * Nova Desktop - NovaOrb Component
 * Main wrapper for the 3D AI Core visualization with bloom post-processing
 */

import React, { Suspense, useCallback, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
// NOTE: Postprocessing disabled due to Vite "Dynamic require of buffer" error
// To re-enable: npm install vite-plugin-node-polyfills and update vite.config.ts
// import { EffectComposer, Bloom, Noise, Vignette } from '@react-three/postprocessing';
import { NovaParticles, NovaState } from './NovaParticles';

interface NovaOrbProps {
  state?: NovaState;
  audioLevel?: number;
  particleCount?: number;
  interactive?: boolean;
  onStateClick?: () => void;
  className?: string;
  /** Disable postprocessing for debugging */
  disablePostProcessing?: boolean;
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

// NOTE: PostProcessing disabled due to Vite "Dynamic require of buffer" error
// To re-enable bloom effects:
// 1. npm install vite-plugin-node-polyfills
// 2. Add to vite.config.ts: nodePolyfills({ include: ['buffer'] })
// 3. Uncomment the import and PostProcessing component below
//
// function PostProcessing() {
//   return (
//     <EffectComposer>
//       <Bloom intensity={1.5} luminanceThreshold={0.1} luminanceSmoothing={0.9} mipmapBlur={true} />
//       <Noise opacity={0.015} />
//       <Vignette eskil={false} offset={0.1} darkness={0.5} />
//     </EffectComposer>
//   );
// }

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
    console.error('[NovaOrb] WebGL Error:', error, errorInfo);
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
 * NovaOrb - The main visual component for Nova
 * Renders a 3D AI Core particle system that responds to AI state
 */
export function NovaOrb({
  state = 'idle',
  audioLevel = 0,
  particleCount = 30000,
  interactive = true,
  onStateClick,
  className = '',
  disablePostProcessing = false, // Enabled by default for full visual effect
}: NovaOrbProps) {
  const [isHovered, setIsHovered] = useState(false);

  console.log(
    '[NovaOrb] Rendering with state:',
    state,
    'particleCount:',
    particleCount,
    'disablePostProcessing:',
    disablePostProcessing
  );

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
            background: '#000000',
            cursor: interactive ? 'pointer' : 'default',
          }}
          onCreated={({ gl }) => {
            console.log('[NovaOrb] Canvas created, WebGL context:', gl.getContext());
          }}
        >
          {/* Camera positioned for optimal view of the AI Core */}
          <PerspectiveCamera makeDefault position={[0, 0, 8]} fov={50} near={0.1} far={1000} />

          {/* Ambient light for subtle fill */}
          <ambientLight intensity={0.05} />

          {/* Suspense boundary for async loading */}
          <Suspense fallback={<OrbLoader />}>
            <NovaParticles state={state} audioLevel={audioLevel} particleCount={particleCount} />

            {/* Post-processing effects disabled - see note above */}
            {/* {!disablePostProcessing && <PostProcessing />} */}
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

export default NovaOrb;
