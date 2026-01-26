/* eslint-disable no-console */
/**
 * Atlas Desktop - AtlasOrb Component
 * Main wrapper for the 3D AI Core visualization with bloom post-processing
 * 
 * Updated: MCU JARVIS-style holographic orb with golden core, 
 * geometric wireframe, orbital rings, and energy effects
 */

import React, { Suspense, useCallback, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
// NOTE: Postprocessing disabled due to Vite "Dynamic require of buffer" error
// To re-enable: npm install vite-plugin-node-polyfills and update vite.config.ts
// import { EffectComposer, Bloom, Noise, Vignette } from '@react-three/postprocessing';
import { AtlasParticles, AtlasState } from './AtlasParticles';
import { Background3D, BackgroundTheme, BackgroundQuality } from './Background3D';
import { JarvisWireframe } from './JarvisWireframe';
import { JarvisCore } from './JarvisCore';
import { OrbitalRings } from './OrbitalRings';
import { EnergyTendrils } from './EnergyTendrils';
import { NeuralConnections } from './NeuralConnections';
import { HologramEffects, DataStream } from './HologramEffects';
import { HexGrid } from './HexGrid';
import { ArcReactor } from './ArcReactor';
import { getTheme, ColorThemePreset } from './colorThemes';

/**
 * ARIA state descriptions for accessibility (Session 039-B)
 */
const STATE_DESCRIPTIONS: Record<AtlasState, { label: string; description: string }> = {
  idle: {
    label: 'Ready',
    description: 'Atlas is ready. Say "Hey Atlas" or press Space to activate.',
  },
  listening: {
    label: 'Listening',
    description: 'Atlas is listening to your voice. Press Escape to cancel.',
  },
  thinking: {
    label: 'Processing',
    description: 'Atlas is processing your request. Please wait.',
  },
  speaking: {
    label: 'Speaking',
    description: 'Atlas is responding. Press Escape to stop or speak to interrupt.',
  },
  error: {
    label: 'Error',
    description: 'An error occurred. Check the error message and try again.',
  },
};

interface AtlasOrbProps {
  state?: AtlasState;
  audioLevel?: number;
  particleCount?: number;
  interactive?: boolean;
  onStateClick?: () => void;
  className?: string;
  /** Disable postprocessing for debugging */
  disablePostProcessing?: boolean;
  /** Performance mode: 'high' | 'balanced' | 'power-saver' */
  performanceMode?: 'high' | 'balanced' | 'power-saver';
  /** Enable GPU memory monitoring */
  enableMemoryMonitoring?: boolean;
  /** Callback when performance level changes */
  onPerformanceChange?: (level: 'normal' | 'degraded' | 'minimal') => void;
  // 3D Background settings
  /** Enable 3D background effects (default: true) */
  enableBackground?: boolean;
  /** Background theme (default: 'nebula') */
  backgroundTheme?: BackgroundTheme;
  /** Background quality for performance (default: 'medium') */
  backgroundQuality?: BackgroundQuality;
  /** Enable parallax effect on mouse movement (default: true) */
  enableParallax?: boolean;
  /** Background opacity 0-1 (default: 0.6) */
  backgroundOpacity?: number;
  // JARVIS-style effects
  /** Color theme preset (default: 'jarvis') */
  colorTheme?: ColorThemePreset;
  /** Enable JARVIS core glow (default: true) */
  enableCore?: boolean;
  /** Enable JARVIS wireframe shell (default: true) */
  enableWireframe?: boolean;
  /** Enable orbital rings (default: true) */
  enableOrbitalRings?: boolean;
  /** Enable energy tendrils (default: true) */
  enableEnergyTendrils?: boolean;
  /** Enable neural connections (default: false - cleaner look) */
  enableNeuralConnections?: boolean;
  /** Enable hologram effects (default: true) */
  enableHologramEffects?: boolean;
  /** Enable data stream particles (default: true) */
  enableDataStream?: boolean;
  /** Enable hex grid overlay (default: true) */
  enableHexGrid?: boolean;
  /** Enable arc reactor effect (default: true) */
  enableArcReactor?: boolean;
  /** JARVIS effects intensity 0-1 (default: 1.0) */
  jarvisIntensity?: number;
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
    console.error('[AtlasOrb] WebGL Error:', error, errorInfo);
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
 * AtlasOrb - The main visual component for Atlas
 * Renders a 3D AI Core particle system that responds to AI state
 * MCU JARVIS-style holographic visualization
 */
export function AtlasOrb({
  state = 'idle',
  audioLevel = 0,
  particleCount = 5000, // Reduced from 15000 for stability
  interactive = true,
  onStateClick,
  className = '',
  disablePostProcessing: _disablePostProcessing = false,
  performanceMode = 'power-saver', // Changed default from 'balanced'
  enableMemoryMonitoring = true,
  onPerformanceChange,
  // 3D Background settings
  enableBackground = false, // Disabled by default for performance
  backgroundTheme = 'nebula',
  backgroundQuality = 'low', // Changed from 'medium'
  enableParallax = false, // Disabled for performance
  backgroundOpacity = 0.4,
  // JARVIS-style effects - many disabled for performance
  colorTheme = 'jarvis',
  enableCore = true,
  enableWireframe = false, // Disabled for performance
  enableOrbitalRings = false, // Disabled for performance
  enableEnergyTendrils = false, // Disabled for performance
  enableNeuralConnections = false,
  enableHologramEffects = false, // Disabled for performance
  enableDataStream = false, // Disabled for performance
  enableHexGrid = false, // Disabled for performance
  enableArcReactor = false, // Disabled for performance
  jarvisIntensity = 0.7, // Reduced from 1.0
}: AtlasOrbProps) {
  const [isHovered, setIsHovered] = useState(false);

  // Get state description for accessibility (Session 039-B)
  const stateInfo = useMemo(() => STATE_DESCRIPTIONS[state], [state]);
  
  // Get theme colors for JARVIS effects
  const theme = useMemo(() => getTheme(colorTheme), [colorTheme]);
  const themeColor = useMemo(() => theme.stateColors[state], [theme, state]);

  console.log(
    '[AtlasOrb] Rendering MCU JARVIS-style orb with state:',
    state,
    'intensity:',
    jarvisIntensity
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

  // Handle keyboard activation (Enter and Space)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick]
  );

  return (
    <div
      className={`atlas-orb-container ${className} ${isHovered ? 'hovered' : ''}`}
      onClick={handleClick}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      role="button"
      tabIndex={interactive ? 0 : -1}
      onKeyDown={handleKeyDown}
      aria-label={`Atlas orb - ${stateInfo.label}. ${stateInfo.description}`}
      aria-pressed={state === 'listening' ? true : undefined}
      aria-busy={state === 'thinking'}
      aria-describedby="orb-state-description"
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
            console.log('[AtlasOrb] Canvas created, WebGL context:', gl.getContext());
          }}
        >
          {/* Camera positioned for optimal view of the AI Core */}
          <PerspectiveCamera makeDefault position={[0, 0, 8]} fov={50} near={0.1} far={1000} />

          {/* Ambient light for subtle fill */}
          <ambientLight intensity={0.05} />

          {/* Suspense boundary for async loading */}
          <Suspense fallback={<OrbLoader />}>
            {/* 3D Background effects layer (behind orb) */}
            {enableBackground && (
              <Background3D
                theme={backgroundTheme}
                enabled={enableBackground}
                quality={backgroundQuality}
                enableParallax={enableParallax}
                parallaxIntensity={0.3}
                opacity={backgroundOpacity}
                speed={1.0}
                atlasState={state}
                audioLevel={audioLevel}
              />
            )}

            {/* JARVIS Core - the glowing golden energy center */}
            {enableCore && (
              <JarvisCore
                state={state}
                intensity={jarvisIntensity}
                audioLevel={audioLevel}
                enabled={enableCore}
              />
            )}

            {/* Main orb particle system - reduced, supplements core */}
            <AtlasParticles
              state={state}
              audioLevel={audioLevel}
              particleCount={particleCount}
              performanceMode={performanceMode}
              enableMemoryMonitoring={enableMemoryMonitoring}
              onPerformanceChange={onPerformanceChange}
            />

            {/* JARVIS-style wireframe shell - geometric cage */}
            {enableWireframe && (
              <JarvisWireframe
                state={state}
                intensity={jarvisIntensity}
                themeColor={themeColor}
                enabled={enableWireframe}
                scale={1.6}
                rotationSpeed={0.2}
                audioLevel={audioLevel}
              />
            )}

            {/* Orbital rings - rotating around the core */}
            {enableOrbitalRings && (
              <OrbitalRings
                state={state}
                intensity={jarvisIntensity * 0.8}
                themeColor={themeColor}
                enabled={enableOrbitalRings}
                audioLevel={audioLevel}
              />
            )}

            {/* Energy tendrils - plasma filaments */}
            {enableEnergyTendrils && (
              <EnergyTendrils
                state={state}
                intensity={jarvisIntensity * 0.6}
                audioLevel={audioLevel}
                themeColor={themeColor}
                enabled={enableEnergyTendrils}
                tendrilCount={8}
              />
            )}

            {/* Neural connections network (optional) */}
            {enableNeuralConnections && (
              <NeuralConnections
                state={state}
                intensity={jarvisIntensity * 0.5}
                themeColor={themeColor}
                enabled={enableNeuralConnections}
                nodeCount={30}
                connectionDensity={0.1}
                radius={1.6}
              />
            )}

            {/* Hologram overlay effects */}
            {enableHologramEffects && (
              <HologramEffects
                state={state}
                intensity={jarvisIntensity * 0.4}
                themeColor={themeColor}
                enabled={enableHologramEffects}
              />
            )}

            {/* Data stream particles */}
            {enableDataStream && (
              <DataStream
                state={state}
                intensity={jarvisIntensity * 0.5}
                themeColor={themeColor}
                enabled={enableDataStream}
                particleCount={60}
              />
            )}

            {/* Hex grid overlay - MCU holographic interface */}
            {enableHexGrid && (
              <HexGrid
                state={state}
                intensity={jarvisIntensity * 0.4}
                themeColor={themeColor}
                enabled={enableHexGrid}
                audioLevel={audioLevel}
              />
            )}

            {/* Arc Reactor effect - concentric energy rings */}
            {enableArcReactor && (
              <ArcReactor
                state={state}
                intensity={jarvisIntensity * 0.3}
                themeColor={themeColor}
                enabled={enableArcReactor}
                audioLevel={audioLevel}
              />
            )}

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
      <div className={`orb-state-indicator orb-state-${state}`} aria-hidden="true" />

      {/* Hidden description for screen readers (Session 039-B) */}
      <div id="orb-state-description" className="sr-only">
        {stateInfo.description}
      </div>
    </div>
  );
}

export default AtlasOrb;
