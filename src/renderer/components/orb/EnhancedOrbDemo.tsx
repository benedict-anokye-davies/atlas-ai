/**
 * Atlas Desktop - Enhanced Orb Demo
 * Showcases the new GPGPU particle system with 100k+ particles and trails
 *
 * Usage:
 * ```tsx
 * import { EnhancedOrbDemo } from './components/orb/EnhancedOrbDemo';
 *
 * function App() {
 *   return <EnhancedOrbDemo />;
 * }
 * ```
 */

import { useState, useCallback, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, PerformanceMonitor } from '@react-three/drei';
import {
  EnhancedAtlasParticles,
  type EnhancedParticleConfig,
} from './EnhancedAtlasParticles';
import type { AtlasState } from './AtlasParticles';

//=============================================================================
// DEMO COMPONENT
//=============================================================================

interface EnhancedOrbDemoProps {
  /** Initial Atlas state */
  initialState?: AtlasState;
  /** Initial performance mode */
  initialPerformanceMode?: 'ultra' | 'high' | 'balanced' | 'power-saver';
  /** Show performance overlay */
  showPerformanceOverlay?: boolean;
  /** Show controls panel */
  showControls?: boolean;
}

export function EnhancedOrbDemo({
  initialState = 'idle',
  initialPerformanceMode = 'high',
  showPerformanceOverlay = true,
  showControls = true,
}: EnhancedOrbDemoProps) {
  // State
  const [atlasState, setAtlasState] = useState<AtlasState>(initialState);
  const [audioLevel, setAudioLevel] = useState(0);
  const [bass, setBass] = useState(0);
  const [treble, setTreble] = useState(0);
  const [performanceMode, setPerformanceMode] = useState(initialPerformanceMode);
  const [enableTrails, setEnableTrails] = useState(true);
  const [trailLength, setTrailLength] = useState(12);
  const [trailStyle, setTrailStyle] = useState<'solid' | 'fading' | 'dotted' | 'energy' | 'plasma'>('fading');
  const [fps, setFps] = useState(60);
  const [particleCount, setParticleCount] = useState(0);

  // Config
  const config: Partial<EnhancedParticleConfig> = {
    performanceMode,
    enableTrails,
    trailConfig: {
      enabled: enableTrails,
      length: trailLength,
      width: 1.5,
      opacity: 0.6,
      style: trailStyle,
      colorGradient: true,
      stateResponsive: true,
      audioReactive: true,
      fadeExponent: 2.0,
    },
    enableAdaptiveQuality: true,
  };

  // Performance callback
  const handlePerformanceChange = useCallback((newFps: number, newParticleCount: number) => {
    setFps(newFps);
    setParticleCount(newParticleCount);
  }, []);

  // Simulate audio input for demo
  const simulateAudio = useCallback((level: number) => {
    setAudioLevel(level);
    setBass(level * 0.8 + Math.random() * 0.2);
    setTreble(level * 0.6 + Math.random() * 0.4);
  }, []);

  return (
    <div style={{ width: '100%', height: '100vh', background: '#0a0a0f', position: 'relative' }}>
      {/* Three.js Canvas */}
      <Canvas
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
          stencil: false,
          depth: true,
        }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <PerspectiveCamera makeDefault position={[0, 0, 5]} fov={60} />
          <OrbitControls
            enableDamping
            dampingFactor={0.05}
            rotateSpeed={0.5}
            minDistance={2}
            maxDistance={15}
          />

          {/* Performance monitor for adaptive quality */}
          <PerformanceMonitor
            onIncline={() => {
              if (performanceMode !== 'ultra') {
                const modes = ['power-saver', 'balanced', 'high', 'ultra'] as const;
                const idx = modes.indexOf(performanceMode);
                if (idx < modes.length - 1) {
                  setPerformanceMode(modes[idx + 1]);
                }
              }
            }}
            onDecline={() => {
              if (performanceMode !== 'power-saver') {
                const modes = ['power-saver', 'balanced', 'high', 'ultra'] as const;
                const idx = modes.indexOf(performanceMode);
                if (idx > 0) {
                  setPerformanceMode(modes[idx - 1]);
                }
              }
            }}
          />

          {/* Enhanced GPGPU Particles */}
          <EnhancedAtlasParticles
            state={atlasState}
            audioLevel={audioLevel}
            bass={bass}
            treble={treble}
            pulse={0}
            config={config}
            onPerformanceChange={handlePerformanceChange}
          />

          {/* Ambient lighting */}
          <ambientLight intensity={0.1} />
          <pointLight position={[10, 10, 10]} intensity={0.5} />
        </Suspense>
      </Canvas>

      {/* Performance Overlay */}
      {showPerformanceOverlay && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            background: 'rgba(0, 0, 0, 0.7)',
            color: '#00d4ff',
            padding: '12px 16px',
            borderRadius: 8,
            fontFamily: 'monospace',
            fontSize: 12,
            pointerEvents: 'none',
          }}
        >
          <div>FPS: <span style={{ color: fps >= 55 ? '#00ff88' : fps >= 30 ? '#ffaa00' : '#ff3333' }}>{fps}</span></div>
          <div>Particles: {(particleCount / 1000).toFixed(1)}k</div>
          <div>Mode: {performanceMode}</div>
          <div>Trails: {enableTrails ? 'ON' : 'OFF'}</div>
        </div>
      )}

      {/* Controls Panel */}
      {showControls && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'rgba(0, 0, 0, 0.85)',
            color: '#fff',
            padding: 16,
            borderRadius: 8,
            width: 280,
            fontFamily: 'system-ui, sans-serif',
            fontSize: 13,
          }}
        >
          <h3 style={{ margin: '0 0 16px', color: '#00d4ff' }}>Enhanced Orb Controls</h3>

          {/* State Selector */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, color: '#888' }}>Atlas State</label>
            <select
              value={atlasState}
              onChange={(e) => setAtlasState(e.target.value as AtlasState)}
              style={{
                width: '100%',
                padding: '8px',
                background: '#1a1a2e',
                color: '#fff',
                border: '1px solid #333',
                borderRadius: 4,
              }}
            >
              <option value="idle">Idle</option>
              <option value="listening">Listening</option>
              <option value="thinking">Thinking</option>
              <option value="speaking">Speaking</option>
              <option value="error">Error</option>
            </select>
          </div>

          {/* Performance Mode */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, color: '#888' }}>Performance Mode</label>
            <select
              value={performanceMode}
              onChange={(e) => setPerformanceMode(e.target.value as 'ultra' | 'high' | 'balanced' | 'power-saver')}
              style={{
                width: '100%',
                padding: '8px',
                background: '#1a1a2e',
                color: '#fff',
                border: '1px solid #333',
                borderRadius: 4,
              }}
            >
              <option value="ultra">Ultra (150k)</option>
              <option value="high">High (100k)</option>
              <option value="balanced">Balanced (60k)</option>
              <option value="power-saver">Power Saver (30k)</option>
            </select>
          </div>

          {/* Audio Level Slider */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, color: '#888' }}>
              Audio Level: {audioLevel.toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={audioLevel}
              onChange={(e) => simulateAudio(parseFloat(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>

          {/* Trails Toggle */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={enableTrails}
                onChange={(e) => setEnableTrails(e.target.checked)}
              />
              <span>Enable Particle Trails</span>
            </label>
          </div>

          {/* Trail Style */}
          {enableTrails && (
            <>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, color: '#888' }}>Trail Style</label>
                <select
                  value={trailStyle}
                  onChange={(e) => setTrailStyle(e.target.value as 'solid' | 'fading' | 'dotted' | 'energy' | 'plasma')}
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: '#1a1a2e',
                    color: '#fff',
                    border: '1px solid #333',
                    borderRadius: 4,
                  }}
                >
                  <option value="solid">Solid</option>
                  <option value="fading">Fading</option>
                  <option value="dotted">Dotted</option>
                  <option value="energy">Energy</option>
                  <option value="plasma">Plasma</option>
                </select>
              </div>

              {/* Trail Length */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, color: '#888' }}>
                  Trail Length: {trailLength}
                </label>
                <input
                  type="range"
                  min="3"
                  max="20"
                  step="1"
                  value={trailLength}
                  onChange={(e) => setTrailLength(parseInt(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
            </>
          )}

          {/* Info */}
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: '#1a1a2e',
              borderRadius: 4,
              fontSize: 11,
              color: '#666',
            }}
          >
            <div style={{ marginBottom: 4 }}>GPU: RTX 3060 optimized</div>
            <div style={{ marginBottom: 4 }}>Physics: GPGPU (GPU-accelerated)</div>
            <div>Trails: Ring buffer texture</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default EnhancedOrbDemo;
