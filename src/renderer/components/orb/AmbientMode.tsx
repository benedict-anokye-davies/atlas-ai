/**
 * Atlas Desktop - Ambient Mode Component
 * Screensaver/ambient mode for idle state with calming particle animations
 *
 * Features:
 * - Activates after configurable idle time
 * - Multiple ambient themes (nebula, waves, aurora, fireflies, starfield)
 * - Optional clock/time display
 * - Optional ambient audio visualization
 * - Exit on any user input (mouse, keyboard, touch)
 * - Low CPU/GPU optimized animations
 */

import { useRef, useMemo, useCallback, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Available ambient theme types
 */
export type AmbientTheme = 'nebula' | 'waves' | 'aurora' | 'fireflies' | 'starfield' | 'minimal';

/**
 * Clock display format options
 */
export type ClockFormat = '12h' | '24h' | 'hidden';

/**
 * Ambient mode configuration
 */
export interface AmbientModeConfig {
  /** Idle time in milliseconds before activating (default: 5 minutes) */
  idleTimeout: number;
  /** Selected ambient theme */
  theme: AmbientTheme;
  /** Clock display format */
  clockFormat: ClockFormat;
  /** Show date along with time */
  showDate: boolean;
  /** Enable ambient audio visualization */
  enableAudioVisualization: boolean;
  /** Particle count (lower = better performance) */
  particleCount: number;
  /** Animation speed multiplier (0.1 - 2.0) */
  animationSpeed: number;
  /** Brightness level (0.3 - 1.0) */
  brightness: number;
  /** Enable subtle mouse parallax effect */
  enableParallax: boolean;
}

/**
 * Props for the AmbientMode component
 */
export interface AmbientModeProps {
  /** Whether ambient mode is active */
  isActive: boolean;
  /** Configuration options */
  config?: Partial<AmbientModeConfig>;
  /** Callback when user exits ambient mode */
  onExit: () => void;
  /** Optional audio level for visualization (0-1) */
  audioLevel?: number;
  /** Custom CSS class */
  className?: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: AmbientModeConfig = {
  idleTimeout: 5 * 60 * 1000, // 5 minutes
  theme: 'nebula',
  clockFormat: '12h',
  showDate: true,
  enableAudioVisualization: false,
  particleCount: 3000, // Lower count for performance
  animationSpeed: 0.3, // Slow, calming speed
  brightness: 0.7,
  enableParallax: true,
};

// ============================================================================
// Theme Color Configurations
// ============================================================================

interface ThemeColors {
  primary: { r: number; g: number; b: number };
  secondary: { r: number; g: number; b: number };
  accent: { r: number; g: number; b: number };
  background: string;
}

const THEME_COLORS: Record<AmbientTheme, ThemeColors> = {
  nebula: {
    primary: { r: 0.4, g: 0.2, b: 0.8 }, // Deep purple
    secondary: { r: 0.0, g: 0.6, b: 0.9 }, // Cyan blue
    accent: { r: 0.8, g: 0.3, b: 0.6 }, // Pink
    background: '#050510',
  },
  waves: {
    primary: { r: 0.0, g: 0.5, b: 0.8 }, // Ocean blue
    secondary: { r: 0.0, g: 0.7, b: 0.7 }, // Teal
    accent: { r: 0.2, g: 0.8, b: 0.9 }, // Light cyan
    background: '#030812',
  },
  aurora: {
    primary: { r: 0.0, g: 0.9, b: 0.5 }, // Aurora green
    secondary: { r: 0.4, g: 0.2, b: 0.8 }, // Purple
    accent: { r: 0.8, g: 0.4, b: 0.7 }, // Pink
    background: '#020815',
  },
  fireflies: {
    primary: { r: 1.0, g: 0.9, b: 0.4 }, // Warm yellow
    secondary: { r: 0.6, g: 1.0, b: 0.4 }, // Green-yellow
    accent: { r: 1.0, g: 0.7, b: 0.3 }, // Orange
    background: '#0a0a05',
  },
  starfield: {
    primary: { r: 1.0, g: 1.0, b: 1.0 }, // White
    secondary: { r: 0.8, g: 0.9, b: 1.0 }, // Blue-white
    accent: { r: 1.0, g: 0.95, b: 0.8 }, // Warm white
    background: '#000005',
  },
  minimal: {
    primary: { r: 0.0, g: 0.7, b: 1.0 }, // Cyan
    secondary: { r: 0.0, g: 0.5, b: 0.8 }, // Blue
    accent: { r: 0.4, g: 0.4, b: 0.5 }, // Gray
    background: '#000000',
  },
};

// ============================================================================
// Shader Code
// ============================================================================

const ambientVertexShader = /* glsl */ `
  attribute float size;
  attribute vec3 customColor;
  attribute float alpha;
  attribute float phase;

  varying vec3 vColor;
  varying float vAlpha;

  uniform float uTime;
  uniform float uSpeed;
  uniform float uTheme; // 0=nebula, 1=waves, 2=aurora, 3=fireflies, 4=starfield, 5=minimal
  uniform float uAudioLevel;
  uniform vec2 uMouse;
  uniform float uParallax;

  // Simple 3D noise
  float noise(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 45.5432))) * 43758.5453);
  }

  void main() {
    vColor = customColor;
    vAlpha = alpha;

    vec3 pos = position;
    float time = uTime * uSpeed;

    // Theme-specific movement patterns
    if (uTheme < 0.5) {
      // Nebula - slow swirling motion
      float swirl = sin(pos.y * 0.5 + time * 0.3 + phase) * 0.3;
      pos.x += swirl;
      pos.z += cos(pos.x * 0.4 + time * 0.2 + phase) * 0.2;
      pos.y += sin(time * 0.15 + phase) * 0.1;
    } else if (uTheme < 1.5) {
      // Waves - horizontal wave motion
      pos.y += sin(pos.x * 0.8 + time * 0.5 + phase) * 0.4;
      pos.y += sin(pos.z * 0.6 + time * 0.3) * 0.2;
      pos.x += sin(time * 0.2 + phase) * 0.1;
    } else if (uTheme < 2.5) {
      // Aurora - vertical curtain movement
      float curtain = sin(pos.x * 0.3 + time * 0.4 + phase) * 0.5;
      pos.y += curtain + sin(time * 0.25 + phase * 2.0) * 0.3;
      pos.z += cos(pos.y * 0.5 + time * 0.2) * 0.2;
    } else if (uTheme < 3.5) {
      // Fireflies - random floating motion
      pos.x += sin(time * 0.8 + phase * 6.28) * 0.15;
      pos.y += cos(time * 0.6 + phase * 3.14) * 0.2 + sin(time * 0.3) * 0.1;
      pos.z += sin(time * 0.5 + phase * 4.71) * 0.15;
      // Occasional "blink" via alpha modulation
      vAlpha *= 0.3 + 0.7 * pow(sin(time * 2.0 + phase * 6.28), 8.0);
    } else if (uTheme < 4.5) {
      // Starfield - gentle twinkling with slow drift
      pos.z += time * 0.02; // Slow drift towards camera
      if (pos.z > 5.0) pos.z -= 10.0; // Loop back
      // Twinkling
      vAlpha *= 0.5 + 0.5 * sin(time * 3.0 + phase * 6.28);
    } else {
      // Minimal - very subtle breathing motion
      float breath = sin(time * 0.5) * 0.05 + 1.0;
      pos *= breath;
    }

    // Audio reactivity (subtle)
    pos *= 1.0 + uAudioLevel * 0.15;
    vAlpha *= 1.0 + uAudioLevel * 0.3;

    // Mouse parallax effect
    if (uParallax > 0.5) {
      float parallaxStrength = 0.3;
      pos.x += uMouse.x * parallaxStrength * (1.0 - length(pos) * 0.1);
      pos.y += uMouse.y * parallaxStrength * (1.0 - length(pos) * 0.1);
    }

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

    // Size attenuation
    float sizeAtten = size * (50.0 / -mvPosition.z);

    // Fireflies have larger, more visible particles
    if (uTheme > 2.5 && uTheme < 3.5) {
      sizeAtten *= 1.5;
    }

    gl_PointSize = clamp(sizeAtten, 0.5, 6.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const ambientFragmentShader = /* glsl */ `
  precision highp float;

  varying vec3 vColor;
  varying float vAlpha;

  uniform float uBrightness;

  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);

    if (dist > 0.5) discard;

    // Soft glow falloff
    float core = exp(-dist * 5.0);
    float glow = exp(-dist * 2.0) * 0.3;
    float intensity = (core + glow) * uBrightness;

    // Color with white-hot center
    vec3 finalColor = mix(vColor, vec3(1.0), core * 0.4);
    finalColor *= intensity;

    float alpha = (core + glow * 0.5) * vAlpha;
    if (alpha < 0.01) discard;

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate particle positions for ambient themes
 */
function generateAmbientParticles(
  count: number,
  theme: AmbientTheme
): {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  alphas: Float32Array;
  phases: Float32Array;
} {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const phases = new Float32Array(count);

  const themeColors = THEME_COLORS[theme];

  for (let i = 0; i < count; i++) {
    // Position distribution varies by theme
    let x: number, y: number, z: number;

    switch (theme) {
      case 'waves':
        // Horizontal plane distribution
        x = (Math.random() - 0.5) * 15;
        y = (Math.random() - 0.5) * 4;
        z = (Math.random() - 0.5) * 8;
        break;
      case 'aurora':
        // Vertical curtain distribution
        x = (Math.random() - 0.5) * 12;
        y = (Math.random() - 0.5) * 8;
        z = (Math.random() - 0.5) * 4;
        break;
      case 'fireflies':
        // Scattered in a volume
        x = (Math.random() - 0.5) * 10;
        y = (Math.random() - 0.5) * 6;
        z = (Math.random() - 0.5) * 6;
        break;
      case 'starfield':
        // Deep field distribution
        x = (Math.random() - 0.5) * 20;
        y = (Math.random() - 0.5) * 15;
        z = Math.random() * 10 - 5;
        break;
      case 'minimal': {
        // Tight sphere
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 2 + Math.random() * 1;
        x = r * Math.sin(phi) * Math.cos(theta);
        y = r * Math.sin(phi) * Math.sin(theta);
        z = r * Math.cos(phi);
        break;
      }
      case 'nebula':
      default:
        // Cloud-like distribution
        x = (Math.random() - 0.5) * 12;
        y = (Math.random() - 0.5) * 8;
        z = (Math.random() - 0.5) * 6;
        break;
    }

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // Color mixing between theme colors
    const colorMix = Math.random();
    let baseColor;
    if (colorMix < 0.5) {
      baseColor = themeColors.primary;
    } else if (colorMix < 0.85) {
      baseColor = themeColors.secondary;
    } else {
      baseColor = themeColors.accent;
    }

    // Add slight color variance
    const variance = 0.1;
    colors[i * 3] = Math.max(0, Math.min(1, baseColor.r + (Math.random() - 0.5) * variance));
    colors[i * 3 + 1] = Math.max(0, Math.min(1, baseColor.g + (Math.random() - 0.5) * variance));
    colors[i * 3 + 2] = Math.max(0, Math.min(1, baseColor.b + (Math.random() - 0.5) * variance));

    // Size and alpha
    sizes[i] = theme === 'starfield' ? 0.02 + Math.random() * 0.04 : 0.03 + Math.random() * 0.05;

    alphas[i] = theme === 'fireflies' ? 0.6 + Math.random() * 0.4 : 0.4 + Math.random() * 0.5;

    // Random phase for animation offset
    phases[i] = Math.random();
  }

  return { positions, colors, sizes, alphas, phases };
}

/**
 * Get theme index for shader
 */
function getThemeIndex(theme: AmbientTheme): number {
  const themeMap: Record<AmbientTheme, number> = {
    nebula: 0,
    waves: 1,
    aurora: 2,
    fireflies: 3,
    starfield: 4,
    minimal: 5,
  };
  return themeMap[theme];
}

// ============================================================================
// Ambient Particles Component (Three.js)
// ============================================================================

interface AmbientParticlesProps {
  theme: AmbientTheme;
  particleCount: number;
  animationSpeed: number;
  brightness: number;
  enableParallax: boolean;
  audioLevel: number;
}

function AmbientParticles({
  theme,
  particleCount,
  animationSpeed,
  brightness,
  enableParallax,
  audioLevel,
}: AmbientParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const { size } = useThree();

  // Generate particle data
  const particleData = useMemo(() => {
    return generateAmbientParticles(particleCount, theme);
  }, [particleCount, theme]);

  // Create geometry
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(particleData.positions, 3));
    geo.setAttribute('customColor', new THREE.BufferAttribute(particleData.colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(particleData.sizes, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(particleData.alphas, 1));
    geo.setAttribute('phase', new THREE.BufferAttribute(particleData.phases, 1));
    return geo;
  }, [particleData]);

  // Create uniforms
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSpeed: { value: animationSpeed },
      uTheme: { value: getThemeIndex(theme) },
      uAudioLevel: { value: 0 },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uParallax: { value: enableParallax ? 1.0 : 0.0 },
      uBrightness: { value: brightness },
    }),
    [animationSpeed, theme, enableParallax, brightness]
  );

  // Create shader material
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: ambientVertexShader,
      fragmentShader: ambientFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, [uniforms]);

  // Mouse tracking for parallax
  useEffect(() => {
    if (!enableParallax) return;

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = (e.clientX / size.width - 0.5) * 2;
      mouseRef.current.y = -(e.clientY / size.height - 0.5) * 2;
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [enableParallax, size]);

  // Animation loop
  useFrame((_, delta) => {
    if (!pointsRef.current) return;

    // Update time (capped delta for consistent animation)
    const cappedDelta = Math.min(delta, 0.1);
    material.uniforms.uTime.value += cappedDelta;
    material.uniforms.uAudioLevel.value = audioLevel;

    // Smooth mouse interpolation for parallax
    if (enableParallax) {
      const target = mouseRef.current;
      const current = material.uniforms.uMouse.value;
      current.x += (target.x - current.x) * 0.05;
      current.y += (target.y - current.y) * 0.05;
    }

    // Slow rotation
    pointsRef.current.rotation.y += cappedDelta * 0.02 * animationSpeed;
  });

  return <points ref={pointsRef} geometry={geometry} material={material} />;
}

// ============================================================================
// Clock Display Component
// ============================================================================

interface ClockDisplayProps {
  format: ClockFormat;
  showDate: boolean;
  brightness: number;
}

function ClockDisplay({ format, showDate, brightness }: ClockDisplayProps) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    if (format === 'hidden') return;

    const interval = setInterval(() => {
      setTime(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, [format]);

  if (format === 'hidden') return null;

  const formatTime = () => {
    if (format === '24h') {
      return time.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    }
    return time.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatDate = () => {
    return time.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  };

  const opacity = brightness * 0.9;

  return (
    <div
      className="ambient-clock"
      style={{
        position: 'absolute',
        bottom: '10%',
        left: '50%',
        transform: 'translateX(-50%)',
        textAlign: 'center',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      <div
        style={{
          fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontSize: 'clamp(3rem, 10vw, 8rem)',
          fontWeight: 200,
          letterSpacing: '-0.02em',
          color: `rgba(255, 255, 255, ${opacity})`,
          textShadow: '0 0 40px rgba(100, 150, 255, 0.3)',
          lineHeight: 1,
        }}
      >
        {formatTime()}
      </div>
      {showDate && (
        <div
          style={{
            fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            fontSize: 'clamp(1rem, 3vw, 1.5rem)',
            fontWeight: 300,
            color: `rgba(200, 210, 230, ${opacity * 0.7})`,
            marginTop: '0.5rem',
            letterSpacing: '0.02em',
          }}
        >
          {formatDate()}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Exit Prompt Component
// ============================================================================

interface ExitPromptProps {
  visible: boolean;
  brightness: number;
}

function ExitPrompt({ visible, brightness }: ExitPromptProps) {
  if (!visible) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '3%',
        left: '50%',
        transform: 'translateX(-50%)',
        textAlign: 'center',
        pointerEvents: 'none',
        zIndex: 10,
        opacity: brightness * 0.5,
      }}
    >
      <span
        style={{
          fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontSize: '0.85rem',
          fontWeight: 400,
          color: 'rgba(150, 160, 180, 0.8)',
          letterSpacing: '0.05em',
        }}
      >
        Press any key or move mouse to exit
      </span>
    </div>
  );
}

// ============================================================================
// Main AmbientMode Component
// ============================================================================

export function AmbientMode({
  isActive,
  config: userConfig,
  onExit,
  audioLevel = 0,
  className = '',
}: AmbientModeProps) {
  const config = useMemo(
    () => ({
      ...DEFAULT_CONFIG,
      ...userConfig,
    }),
    [userConfig]
  );

  const [showExitPrompt, setShowExitPrompt] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const exitTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isExitingRef = useRef(false);

  // Handle exit on any input
  const handleExit = useCallback(() => {
    if (isExitingRef.current) return;
    isExitingRef.current = true;
    onExit();
    // Reset after a short delay to allow re-entry
    setTimeout(() => {
      isExitingRef.current = false;
    }, 500);
  }, [onExit]);

  // Set up input listeners for exit
  useEffect(() => {
    if (!isActive) return;

    // Show exit prompt after a short delay
    const promptTimeout = setTimeout(() => {
      setShowExitPrompt(true);
    }, 3000);

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore modifier keys alone
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      handleExit();
    };

    const handleMouseMove = () => {
      // Clear any existing timeout
      if (exitTimeoutRef.current) {
        clearTimeout(exitTimeoutRef.current);
      }

      // Exit after mouse has moved significantly
      exitTimeoutRef.current = setTimeout(() => {
        handleExit();
      }, 100);
    };

    const handleClick = () => {
      handleExit();
    };

    const handleTouch = () => {
      handleExit();
    };

    const handleWheel = () => {
      handleExit();
    };

    // Add listeners
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('touchstart', handleTouch);
    window.addEventListener('wheel', handleWheel);

    return () => {
      clearTimeout(promptTimeout);
      if (exitTimeoutRef.current) {
        clearTimeout(exitTimeoutRef.current);
      }
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('touchstart', handleTouch);
      window.removeEventListener('wheel', handleWheel);
      setShowExitPrompt(false);
    };
  }, [isActive, handleExit]);

  // Don't render if not active
  if (!isActive) return null;

  const themeColors = THEME_COLORS[config.theme];

  return (
    <div
      ref={containerRef}
      className={`ambient-mode ${className}`}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: themeColors.background,
        cursor: 'none',
        overflow: 'hidden',
      }}
    >
      {/* Three.js Canvas */}
      <Canvas
        dpr={[1, 1.5]} // Lower DPR for better performance
        gl={{
          antialias: false, // Disabled for performance
          alpha: false,
          powerPreference: 'low-power', // Prefer power efficiency
          stencil: false,
          depth: false,
        }}
        style={{
          position: 'absolute',
          inset: 0,
        }}
        frameloop="always"
      >
        <PerspectiveCamera makeDefault position={[0, 0, 8]} fov={50} near={0.1} far={100} />

        <AmbientParticles
          theme={config.theme}
          particleCount={config.particleCount}
          animationSpeed={config.animationSpeed}
          brightness={config.brightness}
          enableParallax={config.enableParallax}
          audioLevel={config.enableAudioVisualization ? audioLevel : 0}
        />
      </Canvas>

      {/* Clock Display */}
      <ClockDisplay
        format={config.clockFormat}
        showDate={config.showDate}
        brightness={config.brightness}
      />

      {/* Exit Prompt */}
      <ExitPrompt visible={showExitPrompt} brightness={config.brightness} />

      {/* Vignette overlay for depth */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: `radial-gradient(ellipse at center, transparent 0%, transparent 50%, rgba(0,0,0,${0.4 * config.brightness}) 100%)`,
        }}
      />
    </div>
  );
}

// ============================================================================
// Idle Detection Hook
// ============================================================================

export interface UseIdleDetectionOptions {
  /** Idle timeout in milliseconds */
  timeout: number;
  /** Whether idle detection is enabled */
  enabled: boolean;
  /** Callback when idle state changes */
  onIdleChange?: (isIdle: boolean) => void;
}

export function useIdleDetection({ timeout, enabled, onIdleChange }: UseIdleDetectionOptions): {
  isIdle: boolean;
  resetIdleTimer: () => void;
  idleTime: number;
} {
  const [isIdle, setIsIdle] = useState(false);
  const [idleTime, setIdleTime] = useState(0);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef(Date.now());
  const idleIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const resetIdleTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    setIdleTime(0);

    if (isIdle) {
      setIsIdle(false);
      onIdleChange?.(false);
    }

    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }

    if (enabled) {
      idleTimerRef.current = setTimeout(() => {
        setIsIdle(true);
        onIdleChange?.(true);
      }, timeout);
    }
  }, [enabled, timeout, isIdle, onIdleChange]);

  // Track idle time for progress indicator
  useEffect(() => {
    if (!enabled) return;

    idleIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      setIdleTime(elapsed);
    }, 1000);

    return () => {
      if (idleIntervalRef.current) {
        clearInterval(idleIntervalRef.current);
      }
    };
  }, [enabled]);

  // Set up activity listeners
  useEffect(() => {
    if (!enabled) {
      setIsIdle(false);
      return;
    }

    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'wheel'];

    const handleActivity = () => {
      resetIdleTimer();
    };

    events.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    // Start initial timer
    resetIdleTimer();

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
    };
  }, [enabled, resetIdleTimer]);

  return { isIdle, resetIdleTimer, idleTime };
}

// ============================================================================
// Ambient Mode Manager Hook
// ============================================================================

export interface UseAmbientModeOptions {
  /** Configuration for ambient mode */
  config?: Partial<AmbientModeConfig>;
  /** Whether ambient mode feature is enabled */
  enabled?: boolean;
  /** Audio level for visualization */
  audioLevel?: number;
}

export function useAmbientMode({
  config,
  enabled = true,
  audioLevel: _audioLevel = 0,
}: UseAmbientModeOptions = {}): {
  isAmbientActive: boolean;
  enterAmbientMode: () => void;
  exitAmbientMode: () => void;
  idleProgress: number;
  config: AmbientModeConfig;
} {
  const [isAmbientActive, setIsAmbientActive] = useState(false);

  const fullConfig = useMemo(
    () => ({
      ...DEFAULT_CONFIG,
      ...config,
    }),
    [config]
  );

  const {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    isIdle: _isIdle,
    resetIdleTimer,
    idleTime,
  } = useIdleDetection({
    timeout: fullConfig.idleTimeout,
    enabled: enabled && !isAmbientActive,
    onIdleChange: (idle) => {
      if (idle && enabled) {
        setIsAmbientActive(true);
      }
    },
  });

  const enterAmbientMode = useCallback(() => {
    setIsAmbientActive(true);
  }, []);

  const exitAmbientMode = useCallback(() => {
    setIsAmbientActive(false);
    resetIdleTimer();
  }, [resetIdleTimer]);

  // Calculate progress towards idle (0-1)
  const idleProgress = enabled ? Math.min(1, idleTime / fullConfig.idleTimeout) : 0;

  return {
    isAmbientActive,
    enterAmbientMode,
    exitAmbientMode,
    idleProgress,
    config: fullConfig,
  };
}

// ============================================================================
// Exports
// ============================================================================

export default AmbientMode;

// Export theme utilities
export { THEME_COLORS, DEFAULT_CONFIG };
export type { ThemeColors };
