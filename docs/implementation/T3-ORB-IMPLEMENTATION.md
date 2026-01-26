# T3-ORB: Visualization + UI Implementation Guide

## Terminal 3 Overview

This terminal handles all visual components, the particle orb, and user interface for Atlas.

**Responsibilities:**
- Particle orb with strange attractor physics (Aizawa)
- State-based animations (idle, listening, thinking, speaking)
- Settings panel and configuration UI
- Panel system with smooth transitions
- Responsive layout with orb positioning

---

## Directory Structure

```
src/renderer/
├── App.tsx                    # Main app component
├── main.tsx                   # React entry point
├── components/
│   ├── orb/
│   │   ├── AtlasOrb.tsx      # Main orb container
│   │   ├── ParticleSystem.tsx # Instanced particle rendering
│   │   ├── Attractor.tsx     # Strange attractor implementation
│   │   ├── OrbShaders.ts     # Custom GLSL shaders
│   │   ├── OrbMaterials.ts   # Shader materials
│   │   └── types.ts          # Orb type definitions
│   ├── panels/
│   │   ├── PanelContainer.tsx # Panel layout manager
│   │   ├── ChatPanel.tsx     # Conversation panel
│   │   ├── WorkflowPanel.tsx # Workflow builder/list
│   │   ├── IntegrationPanel.tsx # Integration management
│   │   └── SettingsPanel.tsx # Settings configuration
│   ├── chat/
│   │   ├── MessageList.tsx   # Message display
│   │   ├── MessageInput.tsx  # Text input with voice toggle
│   │   ├── Message.tsx       # Individual message
│   │   └── TypingIndicator.tsx
│   ├── common/
│   │   ├── Button.tsx
│   │   ├── Toggle.tsx
│   │   ├── Slider.tsx
│   │   ├── Select.tsx
│   │   └── Card.tsx
│   └── layout/
│       ├── TitleBar.tsx      # Custom title bar (frameless)
│       ├── Sidebar.tsx       # Navigation sidebar
│       └── StatusBar.tsx     # Bottom status bar
├── hooks/
│   ├── useAtlasState.ts      # Global Atlas state hook
│   ├── useVoice.ts           # Voice interaction hook
│   ├── useOrb.ts             # Orb control hook
│   ├── useSettings.ts        # Settings hook
│   └── useAnimationFrame.ts  # RAF optimization hook
├── stores/
│   ├── atlasStore.ts         # Main Zustand store
│   ├── conversationStore.ts  # Conversation state
│   ├── settingsStore.ts      # Settings state
│   └── uiStore.ts            # UI state (panels, theme)
├── styles/
│   ├── globals.css           # Global styles
│   ├── theme.ts              # Theme constants
│   └── animations.ts         # CSS animation keyframes
└── utils/
    ├── audio-visualizer.ts   # Audio FFT analysis
    ├── easing.ts             # Animation easing functions
    └── performance.ts        # FPS monitoring
```

---

## Core Components

### 1. Main App (`src/renderer/App.tsx`)

```tsx
import React, { useEffect, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { useAtlasStore } from './stores/atlasStore';
import { useUIStore } from './stores/uiStore';
import { AtlasOrb } from './components/orb/AtlasOrb';
import { PanelContainer } from './components/panels/PanelContainer';
import { TitleBar } from './components/layout/TitleBar';
import { StatusBar } from './components/layout/StatusBar';
import { Sidebar } from './components/layout/Sidebar';
import './styles/globals.css';

export function App() {
  const { state, initialize } = useAtlasStore();
  const { activePanel, orbPosition } = useUIStore();

  // Initialize Atlas on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Calculate orb position based on panel state
  const orbStyle = activePanel
    ? { transform: 'translate(-60%, -30%) scale(0.6)', transition: 'transform 0.5s ease-out' }
    : { transform: 'translate(-50%, -50%)', transition: 'transform 0.5s ease-out' };

  return (
    <div className="app-container">
      <TitleBar />

      <div className="main-content">
        <Sidebar />

        <div className="canvas-container" style={orbStyle}>
          <Canvas
            camera={{ position: [0, 0, 5], fov: 75 }}
            dpr={[1, 2]}
            performance={{ min: 0.5 }}
          >
            <PerformanceMonitor
              onDecline={() => useAtlasStore.getState().setQualityPreset('low')}
              onIncline={() => useAtlasStore.getState().setQualityPreset('high')}
            >
              <Suspense fallback={null}>
                <AtlasOrb state={state} />
              </Suspense>
            </PerformanceMonitor>
          </Canvas>
        </div>

        {activePanel && <PanelContainer panel={activePanel} />}
      </div>

      <StatusBar />
    </div>
  );
}

export default App;
```

---

### 2. Atlas Orb (`src/renderer/components/orb/AtlasOrb.tsx`)

```tsx
import React, { useRef, useMemo, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { InstancedMesh, Vector3, Color, Matrix4, Quaternion } from 'three';
import { useAtlasStore, AtlasState } from '../../stores/atlasStore';
import { createOrbMaterial } from './OrbMaterials';
import { aizawaAttractor, updateAttractor } from './Attractor';

// ============================================================================
// Types
// ============================================================================

interface AtlasOrbProps {
  state: AtlasState;
}

interface Particle {
  position: Vector3;
  velocity: Vector3;
  basePosition: Vector3;
  color: Color;
  scale: number;
  offset: number;
}

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  particleCounts: {
    low: 3000,
    medium: 6000,
    high: 10000,
  },
  attractorScale: 0.15,
  baseSpeed: 0.0008,
  stateConfigs: {
    idle: {
      speed: 1.0,
      spread: 1.0,
      brightness: 0.7,
      pulseFrequency: 0.5,
      pulseAmplitude: 0.1,
      colorPrimary: new Color('#4a9eff'),
      colorSecondary: new Color('#7c3aed'),
    },
    listening: {
      speed: 1.5,
      spread: 1.2,
      brightness: 1.0,
      pulseFrequency: 2.0,
      pulseAmplitude: 0.2,
      colorPrimary: new Color('#22c55e'),
      colorSecondary: new Color('#4ade80'),
    },
    thinking: {
      speed: 2.0,
      spread: 0.8,
      brightness: 1.2,
      pulseFrequency: 4.0,
      pulseAmplitude: 0.15,
      colorPrimary: new Color('#f59e0b'),
      colorSecondary: new Color('#fbbf24'),
    },
    speaking: {
      speed: 1.2,
      spread: 1.1,
      brightness: 1.0,
      pulseFrequency: 1.0,
      pulseAmplitude: 0.3,
      colorPrimary: new Color('#8b5cf6'),
      colorSecondary: new Color('#a78bfa'),
    },
    error: {
      speed: 0.5,
      spread: 1.5,
      brightness: 0.6,
      pulseFrequency: 0.3,
      pulseAmplitude: 0.05,
      colorPrimary: new Color('#ef4444'),
      colorSecondary: new Color('#f87171'),
    },
  },
};

// ============================================================================
// Atlas Orb Component
// ============================================================================

export function AtlasOrb({ state }: AtlasOrbProps) {
  const meshRef = useRef<InstancedMesh>(null);
  const particlesRef = useRef<Particle[]>([]);
  const timeRef = useRef(0);
  const transitionRef = useRef({ from: 'idle', progress: 1 });

  const { size } = useThree();
  const qualityPreset = useAtlasStore((s) => s.qualityPreset);
  const audioLevel = useAtlasStore((s) => s.audioLevel);

  // Particle count based on quality
  const particleCount = CONFIG.particleCounts[qualityPreset] || CONFIG.particleCounts.medium;

  // Create material
  const material = useMemo(() => createOrbMaterial(), []);

  // Initialize particles
  useMemo(() => {
    const particles: Particle[] = [];

    for (let i = 0; i < particleCount; i++) {
      // Start with random positions that will converge to attractor
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = Math.random() * 0.5 + 0.5;

      const position = new Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );

      particles.push({
        position: position.clone(),
        velocity: new Vector3(0, 0, 0),
        basePosition: position.clone(),
        color: new Color(),
        scale: Math.random() * 0.5 + 0.5,
        offset: Math.random() * Math.PI * 2,
      });
    }

    particlesRef.current = particles;
  }, [particleCount]);

  // Get interpolated state config
  const getStateConfig = useCallback(() => {
    const currentConfig = CONFIG.stateConfigs[state] || CONFIG.stateConfigs.idle;
    const transition = transitionRef.current;

    if (transition.progress < 1) {
      const prevConfig = CONFIG.stateConfigs[transition.from as keyof typeof CONFIG.stateConfigs] || CONFIG.stateConfigs.idle;
      const t = transition.progress;

      return {
        speed: prevConfig.speed + (currentConfig.speed - prevConfig.speed) * t,
        spread: prevConfig.spread + (currentConfig.spread - prevConfig.spread) * t,
        brightness: prevConfig.brightness + (currentConfig.brightness - prevConfig.brightness) * t,
        pulseFrequency: prevConfig.pulseFrequency + (currentConfig.pulseFrequency - prevConfig.pulseFrequency) * t,
        pulseAmplitude: prevConfig.pulseAmplitude + (currentConfig.pulseAmplitude - prevConfig.pulseAmplitude) * t,
        colorPrimary: prevConfig.colorPrimary.clone().lerp(currentConfig.colorPrimary, t),
        colorSecondary: prevConfig.colorSecondary.clone().lerp(currentConfig.colorSecondary, t),
      };
    }

    return currentConfig;
  }, [state]);

  // Animation frame
  useFrame((_, delta) => {
    if (!meshRef.current) return;

    const mesh = meshRef.current;
    const particles = particlesRef.current;
    const config = getStateConfig();

    timeRef.current += delta;
    const time = timeRef.current;

    // Update transition progress
    if (transitionRef.current.progress < 1) {
      transitionRef.current.progress = Math.min(1, transitionRef.current.progress + delta * 2);
    }

    // Audio reactivity
    const audioMult = 1 + audioLevel * 0.5;

    // Update each particle
    const matrix = new Matrix4();
    const quaternion = new Quaternion();
    const tempColor = new Color();

    for (let i = 0; i < particles.length; i++) {
      const particle = particles[i];

      // Update position using attractor
      const attractorPos = aizawaAttractor(
        particle.basePosition.x,
        particle.basePosition.y,
        particle.basePosition.z,
        time * CONFIG.baseSpeed * config.speed
      );

      // Apply spread
      particle.position.lerp(
        new Vector3(
          attractorPos.x * CONFIG.attractorScale * config.spread,
          attractorPos.y * CONFIG.attractorScale * config.spread,
          attractorPos.z * CONFIG.attractorScale * config.spread
        ),
        0.05
      );

      // Pulse effect
      const pulse = Math.sin(time * config.pulseFrequency + particle.offset) * config.pulseAmplitude;
      const scale = particle.scale * (1 + pulse) * audioMult;

      // Color interpolation based on position
      const colorT = (particle.position.y + 1) / 2;
      tempColor.copy(config.colorPrimary).lerp(config.colorSecondary, colorT);
      tempColor.multiplyScalar(config.brightness);

      // Build matrix
      matrix.compose(
        particle.position,
        quaternion,
        new Vector3(scale * 0.02, scale * 0.02, scale * 0.02)
      );

      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, tempColor);

      // Update base position for attractor
      updateAttractor(particle.basePosition, CONFIG.baseSpeed * config.speed * 0.1);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  // Handle state transitions
  React.useEffect(() => {
    transitionRef.current = { from: transitionRef.current.from, progress: 0 };
    return () => {
      transitionRef.current.from = state;
    };
  }, [state]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, particleCount]}
      material={material}
    >
      <sphereGeometry args={[1, 8, 8]} />
    </instancedMesh>
  );
}
```

---

### 3. Attractor Implementation (`src/renderer/components/orb/Attractor.ts`)

```typescript
import { Vector3 } from 'three';

// ============================================================================
// Aizawa Attractor
// ============================================================================

// Aizawa attractor parameters
const AIZAWA = {
  a: 0.95,
  b: 0.7,
  c: 0.6,
  d: 3.5,
  e: 0.25,
  f: 0.1,
};

/**
 * Calculate Aizawa attractor position
 * Creates a beautiful 3D chaotic pattern
 */
export function aizawaAttractor(x: number, y: number, z: number, dt: number): Vector3 {
  const { a, b, c, d, e, f } = AIZAWA;

  // Aizawa differential equations
  const dx = (z - b) * x - d * y;
  const dy = d * x + (z - b) * y;
  const dz = c + a * z - (z * z * z) / 3 - (x * x + y * y) * (1 + e * z) + f * z * x * x * x;

  return new Vector3(
    x + dx * dt,
    y + dy * dt,
    z + dz * dt
  );
}

/**
 * Update a position along the attractor path
 */
export function updateAttractor(position: Vector3, dt: number): void {
  const next = aizawaAttractor(position.x, position.y, position.z, dt);
  position.copy(next);
}

// ============================================================================
// Alternative Attractors (for variety)
// ============================================================================

// Lorenz attractor
const LORENZ = {
  sigma: 10,
  rho: 28,
  beta: 8 / 3,
};

export function lorenzAttractor(x: number, y: number, z: number, dt: number): Vector3 {
  const { sigma, rho, beta } = LORENZ;

  const dx = sigma * (y - x);
  const dy = x * (rho - z) - y;
  const dz = x * y - beta * z;

  return new Vector3(
    x + dx * dt,
    y + dy * dt,
    z + dz * dt
  );
}

// Thomas attractor (smoother, more symmetric)
const THOMAS = {
  b: 0.208186,
};

export function thomasAttractor(x: number, y: number, z: number, dt: number): Vector3 {
  const { b } = THOMAS;

  const dx = Math.sin(y) - b * x;
  const dy = Math.sin(z) - b * y;
  const dz = Math.sin(x) - b * z;

  return new Vector3(
    x + dx * dt,
    y + dy * dt,
    z + dz * dt
  );
}

// ============================================================================
// Attractor Blending
// ============================================================================

export type AttractorType = 'aizawa' | 'lorenz' | 'thomas';

const attractors: Record<AttractorType, (x: number, y: number, z: number, dt: number) => Vector3> = {
  aizawa: aizawaAttractor,
  lorenz: lorenzAttractor,
  thomas: thomasAttractor,
};

/**
 * Blend between two attractors for smooth transitions
 */
export function blendAttractors(
  position: Vector3,
  from: AttractorType,
  to: AttractorType,
  blend: number,
  dt: number
): Vector3 {
  const fromPos = attractors[from](position.x, position.y, position.z, dt);
  const toPos = attractors[to](position.x, position.y, position.z, dt);

  return new Vector3().lerpVectors(fromPos, toPos, blend);
}
```

---

### 4. Orb Shaders (`src/renderer/components/orb/OrbShaders.ts`)

```typescript
// ============================================================================
// Vertex Shader
// ============================================================================

export const orbVertexShader = /* glsl */ `
  attribute vec3 instanceColor;

  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying float vDepth;

  void main() {
    vColor = instanceColor;
    vNormal = normalMatrix * normal;

    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vPosition = mvPosition.xyz;
    vDepth = -mvPosition.z;

    gl_Position = projectionMatrix * mvPosition;
  }
`;

// ============================================================================
// Fragment Shader
// ============================================================================

export const orbFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uBrightness;
  uniform float uGlow;

  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying float vDepth;

  void main() {
    // Basic lighting
    vec3 lightDir = normalize(vec3(0.5, 1.0, 0.5));
    float diffuse = max(dot(vNormal, lightDir), 0.0);
    float ambient = 0.3;

    // Fresnel effect for glow
    vec3 viewDir = normalize(-vPosition);
    float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 2.0);

    // Depth-based fade
    float depthFade = smoothstep(0.0, 5.0, vDepth);

    // Combine
    vec3 color = vColor * (ambient + diffuse * 0.7);
    color += vColor * fresnel * uGlow;
    color *= uBrightness;
    color *= depthFade;

    // Alpha based on depth and fresnel
    float alpha = (0.7 + fresnel * 0.3) * depthFade;

    gl_FragColor = vec4(color, alpha);
  }
`;

// ============================================================================
// Post-processing: Bloom shader
// ============================================================================

export const bloomVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const bloomFragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uBloomStrength;
  uniform float uBloomRadius;

  varying vec2 vUv;

  const float weights[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

  void main() {
    vec2 texOffset = 1.0 / vec2(textureSize(tDiffuse, 0));
    vec3 result = texture2D(tDiffuse, vUv).rgb * weights[0];

    for (int i = 1; i < 5; i++) {
      float offset = float(i) * uBloomRadius;
      result += texture2D(tDiffuse, vUv + vec2(texOffset.x * offset, 0.0)).rgb * weights[i];
      result += texture2D(tDiffuse, vUv - vec2(texOffset.x * offset, 0.0)).rgb * weights[i];
      result += texture2D(tDiffuse, vUv + vec2(0.0, texOffset.y * offset)).rgb * weights[i];
      result += texture2D(tDiffuse, vUv - vec2(0.0, texOffset.y * offset)).rgb * weights[i];
    }

    gl_FragColor = vec4(result * uBloomStrength, 1.0);
  }
`;
```

---

### 5. Orb Materials (`src/renderer/components/orb/OrbMaterials.ts`)

```typescript
import { ShaderMaterial, AdditiveBlending, DoubleSide } from 'three';
import { orbVertexShader, orbFragmentShader } from './OrbShaders';

export function createOrbMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: orbVertexShader,
    fragmentShader: orbFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uBrightness: { value: 1.0 },
      uGlow: { value: 0.5 },
    },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
}

export function updateOrbMaterial(
  material: ShaderMaterial,
  time: number,
  brightness: number,
  glow: number
): void {
  material.uniforms.uTime.value = time;
  material.uniforms.uBrightness.value = brightness;
  material.uniforms.uGlow.value = glow;
}
```

---

### 6. Panel Container (`src/renderer/components/panels/PanelContainer.tsx`)

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { ChatPanel } from './ChatPanel';
import { WorkflowPanel } from './WorkflowPanel';
import { IntegrationPanel } from './IntegrationPanel';
import { SettingsPanel } from './SettingsPanel';
import { useUIStore, PanelType } from '../../stores/uiStore';
import './PanelContainer.css';

interface PanelContainerProps {
  panel: PanelType;
}

const panelComponents: Record<PanelType, React.FC> = {
  chat: ChatPanel,
  workflows: WorkflowPanel,
  integrations: IntegrationPanel,
  settings: SettingsPanel,
};

export function PanelContainer({ panel }: PanelContainerProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const { closePanel } = useUIStore();

  const PanelComponent = panelComponents[panel];

  // Animate in
  useEffect(() => {
    requestAnimationFrame(() => {
      setIsVisible(true);
    });
  }, []);

  // Handle close with animation
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      closePanel();
    }, 300);
  };

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  return (
    <div
      className={`panel-container ${isVisible ? 'visible' : ''} ${isClosing ? 'closing' : ''}`}
      ref={panelRef}
    >
      <div className="panel-header">
        <h2 className="panel-title">{panel.charAt(0).toUpperCase() + panel.slice(1)}</h2>
        <button className="panel-close" onClick={handleClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M12.207 4.707a1 1 0 00-1.414-1.414L8 6.586 5.207 3.793a1 1 0 00-1.414 1.414L6.586 8l-2.793 2.793a1 1 0 101.414 1.414L8 9.414l2.793 2.793a1 1 0 001.414-1.414L9.414 8l2.793-2.793z" />
          </svg>
        </button>
      </div>
      <div className="panel-content">
        <PanelComponent />
      </div>
    </div>
  );
}
```

---

### 7. Chat Panel (`src/renderer/components/panels/ChatPanel.tsx`)

```tsx
import React, { useRef, useEffect, useState } from 'react';
import { useConversationStore } from '../../stores/conversationStore';
import { useAtlasStore } from '../../stores/atlasStore';
import { MessageList } from '../chat/MessageList';
import { MessageInput } from '../chat/MessageInput';
import { TypingIndicator } from '../chat/TypingIndicator';
import './ChatPanel.css';

export function ChatPanel() {
  const {
    messages,
    currentConversationId,
    isLoading,
    sendMessage,
    loadConversation,
  } = useConversationStore();

  const { state } = useAtlasStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState('');

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle send
  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;

    const message = inputValue.trim();
    setInputValue('');
    await sendMessage(message);
  };

  // Handle voice toggle
  const handleVoiceToggle = () => {
    window.atlas.voice.toggleListening();
  };

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        <MessageList messages={messages} />
        {state === 'thinking' && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-container">
        <MessageInput
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSend}
          onVoiceToggle={handleVoiceToggle}
          isListening={state === 'listening'}
          disabled={isLoading}
        />
      </div>
    </div>
  );
}
```

---

### 8. Settings Panel (`src/renderer/components/panels/SettingsPanel.tsx`)

```tsx
import React from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { Toggle } from '../common/Toggle';
import { Slider } from '../common/Slider';
import { Select } from '../common/Select';
import './SettingsPanel.css';

export function SettingsPanel() {
  const settings = useSettingsStore();

  return (
    <div className="settings-panel">
      {/* Voice Settings */}
      <section className="settings-section">
        <h3>Voice</h3>

        <div className="setting-item">
          <label>Wake Word Detection</label>
          <Toggle
            checked={settings.voice.wakeWordEnabled}
            onChange={(v) => settings.setVoice({ wakeWordEnabled: v })}
          />
        </div>

        <div className="setting-item">
          <label>Wake Word Sensitivity</label>
          <Slider
            value={settings.voice.wakeWordSensitivity}
            onChange={(v) => settings.setVoice({ wakeWordSensitivity: v })}
            min={0}
            max={1}
            step={0.1}
          />
        </div>

        <div className="setting-item">
          <label>Push-to-Talk Shortcut</label>
          <input
            type="text"
            className="setting-input"
            value={settings.voice.pushToTalkKey}
            onChange={(e) => settings.setVoice({ pushToTalkKey: e.target.value })}
            placeholder="Press keys..."
          />
        </div>

        <div className="setting-item">
          <label>Speech Speed</label>
          <Slider
            value={settings.voice.speed}
            onChange={(v) => settings.setVoice({ speed: v })}
            min={0.5}
            max={2}
            step={0.1}
          />
        </div>
      </section>

      {/* Personality Settings */}
      <section className="settings-section">
        <h3>Personality</h3>

        <div className="setting-item">
          <label>Friendliness</label>
          <Slider
            value={settings.personality.friendliness}
            onChange={(v) => settings.setPersonality({ friendliness: v })}
            min={0}
            max={1}
            step={0.1}
          />
        </div>

        <div className="setting-item">
          <label>Formality</label>
          <Slider
            value={settings.personality.formality}
            onChange={(v) => settings.setPersonality({ formality: v })}
            min={0}
            max={1}
            step={0.1}
          />
        </div>

        <div className="setting-item">
          <label>Humor</label>
          <Slider
            value={settings.personality.humor}
            onChange={(v) => settings.setPersonality({ humor: v })}
            min={0}
            max={1}
            step={0.1}
          />
        </div>

        <div className="setting-item">
          <label>Proactiveness</label>
          <Slider
            value={settings.personality.proactiveness}
            onChange={(v) => settings.setPersonality({ proactiveness: v })}
            min={0}
            max={1}
            step={0.1}
          />
        </div>
      </section>

      {/* Visual Settings */}
      <section className="settings-section">
        <h3>Visual</h3>

        <div className="setting-item">
          <label>Quality Preset</label>
          <Select
            value={settings.visual.qualityPreset}
            onChange={(v) => settings.setVisual({ qualityPreset: v })}
            options={[
              { value: 'auto', label: 'Auto (Adaptive)' },
              { value: 'low', label: 'Low (Battery Saver)' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High (Best Quality)' },
            ]}
          />
        </div>

        <div className="setting-item">
          <label>Particle Count</label>
          <Slider
            value={settings.visual.particleCount}
            onChange={(v) => settings.setVisual({ particleCount: v })}
            min={1000}
            max={15000}
            step={1000}
          />
          <span className="setting-value">{settings.visual.particleCount.toLocaleString()}</span>
        </div>
      </section>

      {/* Privacy Settings */}
      <section className="settings-section">
        <h3>Privacy</h3>

        <div className="setting-item">
          <label>Memory Enabled</label>
          <Toggle
            checked={settings.privacy.memoryEnabled}
            onChange={(v) => settings.setPrivacy({ memoryEnabled: v })}
          />
        </div>

        <div className="setting-item">
          <label>Memory Retention (Days)</label>
          <Slider
            value={settings.privacy.memoryRetentionDays}
            onChange={(v) => settings.setPrivacy({ memoryRetentionDays: v })}
            min={7}
            max={365}
            step={7}
          />
          <span className="setting-value">{settings.privacy.memoryRetentionDays} days</span>
        </div>

        <div className="setting-item">
          <label>Incognito Mode</label>
          <Toggle
            checked={settings.privacy.incognitoMode}
            onChange={(v) => settings.setPrivacy({ incognitoMode: v })}
          />
          <p className="setting-description">
            When enabled, conversations are not saved to memory
          </p>
        </div>
      </section>

      {/* System Settings */}
      <section className="settings-section">
        <h3>System</h3>

        <div className="setting-item">
          <label>Start with System</label>
          <Toggle
            checked={settings.system.startWithSystem}
            onChange={(v) => settings.setSystem({ startWithSystem: v })}
          />
        </div>

        <div className="setting-item">
          <label>Start Minimized</label>
          <Toggle
            checked={settings.system.startMinimized}
            onChange={(v) => settings.setSystem({ startMinimized: v })}
          />
        </div>
      </section>

      {/* Danger Zone */}
      <section className="settings-section danger">
        <h3>Data Management</h3>

        <button className="danger-button" onClick={settings.exportData}>
          Export All Data
        </button>

        <button className="danger-button" onClick={settings.clearMemory}>
          Clear Memory
        </button>

        <button className="danger-button destructive" onClick={settings.resetAll}>
          Reset All Settings
        </button>
      </section>
    </div>
  );
}
```

---

### 9. Zustand Stores

#### Atlas Store (`src/renderer/stores/atlasStore.ts`)

```typescript
import { create } from 'zustand';

export type AtlasState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
export type QualityPreset = 'low' | 'medium' | 'high' | 'auto';

interface AtlasStore {
  // State
  state: AtlasState;
  audioLevel: number;
  transcript: string;
  response: string;
  error: string | null;

  // Settings
  qualityPreset: QualityPreset;
  isInitialized: boolean;

  // Actions
  setState: (state: AtlasState) => void;
  setAudioLevel: (level: number) => void;
  setTranscript: (text: string) => void;
  setResponse: (text: string) => void;
  setError: (error: string | null) => void;
  setQualityPreset: (preset: QualityPreset) => void;
  initialize: () => Promise<void>;
  reset: () => void;
}

export const useAtlasStore = create<AtlasStore>((set, get) => ({
  // Initial state
  state: 'idle',
  audioLevel: 0,
  transcript: '',
  response: '',
  error: null,
  qualityPreset: 'auto',
  isInitialized: false,

  // Actions
  setState: (state) => set({ state, error: state === 'error' ? get().error : null }),

  setAudioLevel: (audioLevel) => set({ audioLevel }),

  setTranscript: (transcript) => set({ transcript }),

  setResponse: (response) => set({ response }),

  setError: (error) => set({ error, state: error ? 'error' : get().state }),

  setQualityPreset: (qualityPreset) => {
    set({ qualityPreset });
    window.atlas.settings.set('visual.qualityPreset', qualityPreset);
  },

  initialize: async () => {
    try {
      // Load settings
      const settings = await window.atlas.settings.getAll();
      set({ qualityPreset: settings.visual?.qualityPreset || 'auto' });

      // Set up event listeners
      window.atlas.on('atlas:state-changed', (newState: AtlasState) => {
        set({ state: newState });
      });

      window.atlas.on('atlas:audio-level', (level: number) => {
        set({ audioLevel: level });
      });

      window.atlas.on('atlas:transcript', (text: string) => {
        set({ transcript: text });
      });

      window.atlas.on('atlas:response', (text: string) => {
        set({ response: text });
      });

      window.atlas.on('atlas:error', (error: string) => {
        set({ error, state: 'error' });
      });

      set({ isInitialized: true });
    } catch (error) {
      console.error('Failed to initialize Atlas store:', error);
      set({ error: 'Failed to initialize', state: 'error' });
    }
  },

  reset: () => set({
    state: 'idle',
    audioLevel: 0,
    transcript: '',
    response: '',
    error: null,
  }),
}));
```

#### UI Store (`src/renderer/stores/uiStore.ts`)

```typescript
import { create } from 'zustand';

export type PanelType = 'chat' | 'workflows' | 'integrations' | 'settings';

interface UIStore {
  // Panel state
  activePanel: PanelType | null;
  panelHistory: PanelType[];

  // Orb state
  orbPosition: 'center' | 'corner';
  orbScale: number;

  // Actions
  openPanel: (panel: PanelType) => void;
  closePanel: () => void;
  goBack: () => void;
  setOrbPosition: (position: 'center' | 'corner') => void;
  setOrbScale: (scale: number) => void;
}

export const useUIStore = create<UIStore>((set, get) => ({
  // Initial state
  activePanel: null,
  panelHistory: [],
  orbPosition: 'center',
  orbScale: 1,

  // Actions
  openPanel: (panel) => {
    const { activePanel, panelHistory } = get();

    if (activePanel && activePanel !== panel) {
      set({
        panelHistory: [...panelHistory, activePanel],
      });
    }

    set({
      activePanel: panel,
      orbPosition: 'corner',
      orbScale: 0.6,
    });
  },

  closePanel: () => {
    set({
      activePanel: null,
      panelHistory: [],
      orbPosition: 'center',
      orbScale: 1,
    });
  },

  goBack: () => {
    const { panelHistory } = get();

    if (panelHistory.length > 0) {
      const previousPanel = panelHistory[panelHistory.length - 1];
      set({
        activePanel: previousPanel,
        panelHistory: panelHistory.slice(0, -1),
      });
    } else {
      set({
        activePanel: null,
        orbPosition: 'center',
        orbScale: 1,
      });
    }
  },

  setOrbPosition: (orbPosition) => set({ orbPosition }),

  setOrbScale: (orbScale) => set({ orbScale }),
}));
```

#### Settings Store (`src/renderer/stores/settingsStore.ts`)

```typescript
import { create } from 'zustand';

interface VoiceSettings {
  wakeWordEnabled: boolean;
  wakeWordSensitivity: number;
  pushToTalkKey: string;
  speed: number;
}

interface PersonalitySettings {
  friendliness: number;
  formality: number;
  humor: number;
  proactiveness: number;
}

interface VisualSettings {
  qualityPreset: 'auto' | 'low' | 'medium' | 'high';
  particleCount: number;
}

interface PrivacySettings {
  memoryEnabled: boolean;
  memoryRetentionDays: number;
  incognitoMode: boolean;
}

interface SystemSettings {
  startWithSystem: boolean;
  startMinimized: boolean;
}

interface SettingsStore {
  // Settings
  voice: VoiceSettings;
  personality: PersonalitySettings;
  visual: VisualSettings;
  privacy: PrivacySettings;
  system: SystemSettings;

  // Loading state
  isLoading: boolean;

  // Actions
  load: () => Promise<void>;
  setVoice: (settings: Partial<VoiceSettings>) => void;
  setPersonality: (settings: Partial<PersonalitySettings>) => void;
  setVisual: (settings: Partial<VisualSettings>) => void;
  setPrivacy: (settings: Partial<PrivacySettings>) => void;
  setSystem: (settings: Partial<SystemSettings>) => void;
  exportData: () => Promise<void>;
  clearMemory: () => Promise<void>;
  resetAll: () => Promise<void>;
}

const defaultSettings = {
  voice: {
    wakeWordEnabled: true,
    wakeWordSensitivity: 0.7,
    pushToTalkKey: 'Ctrl+Space',
    speed: 1.0,
  },
  personality: {
    friendliness: 0.9,
    formality: 0.3,
    humor: 0.7,
    proactiveness: 0.6,
  },
  visual: {
    qualityPreset: 'auto' as const,
    particleCount: 8000,
  },
  privacy: {
    memoryEnabled: true,
    memoryRetentionDays: 90,
    incognitoMode: false,
  },
  system: {
    startWithSystem: true,
    startMinimized: false,
  },
};

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...defaultSettings,
  isLoading: true,

  load: async () => {
    try {
      const settings = await window.atlas.settings.getAll();
      set({
        voice: { ...defaultSettings.voice, ...settings.voice },
        personality: { ...defaultSettings.personality, ...settings.personality },
        visual: { ...defaultSettings.visual, ...settings.visual },
        privacy: { ...defaultSettings.privacy, ...settings.privacy },
        system: { ...defaultSettings.system, ...settings.system },
        isLoading: false,
      });
    } catch (error) {
      console.error('Failed to load settings:', error);
      set({ isLoading: false });
    }
  },

  setVoice: (settings) => {
    const newVoice = { ...get().voice, ...settings };
    set({ voice: newVoice });
    window.atlas.settings.set('voice', newVoice);
  },

  setPersonality: (settings) => {
    const newPersonality = { ...get().personality, ...settings };
    set({ personality: newPersonality });
    window.atlas.settings.set('personality', newPersonality);
  },

  setVisual: (settings) => {
    const newVisual = { ...get().visual, ...settings };
    set({ visual: newVisual });
    window.atlas.settings.set('visual', newVisual);
  },

  setPrivacy: (settings) => {
    const newPrivacy = { ...get().privacy, ...settings };
    set({ privacy: newPrivacy });
    window.atlas.settings.set('privacy', newPrivacy);
  },

  setSystem: (settings) => {
    const newSystem = { ...get().system, ...settings };
    set({ system: newSystem });
    window.atlas.settings.set('system', newSystem);
  },

  exportData: async () => {
    await window.atlas.data.export();
  },

  clearMemory: async () => {
    if (confirm('Are you sure you want to clear all memory? This cannot be undone.')) {
      await window.atlas.memory.clear();
    }
  },

  resetAll: async () => {
    if (confirm('Are you sure you want to reset all settings? This cannot be undone.')) {
      await window.atlas.settings.reset();
      set(defaultSettings);
    }
  },
}));
```

---

### 10. Global Styles (`src/renderer/styles/globals.css`)

```css
/* ============================================================================
   CSS Variables
   ============================================================================ */

:root {
  /* Colors */
  --color-bg-primary: #0a0a0f;
  --color-bg-secondary: #12121a;
  --color-bg-tertiary: #1a1a25;
  --color-bg-elevated: #22222f;

  --color-text-primary: #ffffff;
  --color-text-secondary: #a0a0b0;
  --color-text-tertiary: #606070;

  --color-accent-primary: #4a9eff;
  --color-accent-secondary: #7c3aed;
  --color-accent-success: #22c55e;
  --color-accent-warning: #f59e0b;
  --color-accent-error: #ef4444;

  --color-border: rgba(255, 255, 255, 0.1);

  /* Spacing */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;

  /* Border radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.5);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.5);
  --shadow-glow: 0 0 20px rgba(74, 158, 255, 0.3);

  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-normal: 300ms ease;
  --transition-slow: 500ms ease;

  /* Font */
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'SF Mono', 'Fira Code', 'Consolas', monospace;
}

/* ============================================================================
   Reset
   ============================================================================ */

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body, #root {
  height: 100%;
  width: 100%;
}

body {
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  color: var(--color-text-primary);
  background: var(--color-bg-primary);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  overflow: hidden;
}

/* ============================================================================
   App Container
   ============================================================================ */

.app-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}

.main-content {
  display: flex;
  flex: 1;
  position: relative;
  overflow: hidden;
}

/* ============================================================================
   Canvas Container (Orb)
   ============================================================================ */

.canvas-container {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 100%;
  height: 100%;
  z-index: 1;
  pointer-events: none;
}

.canvas-container canvas {
  pointer-events: auto;
}

/* Centered state */
.canvas-container.centered {
  transform: translate(-50%, -50%);
}

/* Corner state (when panel open) */
.canvas-container.corner {
  transform: translate(-85%, -25%) scale(0.5);
}

/* ============================================================================
   Panel Container
   ============================================================================ */

.panel-container {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 450px;
  background: var(--color-bg-secondary);
  border-left: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  z-index: 10;
  transform: translateX(100%);
  opacity: 0;
  transition: transform var(--transition-normal), opacity var(--transition-normal);
}

.panel-container.visible {
  transform: translateX(0);
  opacity: 1;
}

.panel-container.closing {
  transform: translateX(100%);
  opacity: 0;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--color-border);
}

.panel-title {
  font-size: 18px;
  font-weight: 600;
}

.panel-close {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: var(--spacing-sm);
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.panel-close:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-md);
}

/* ============================================================================
   Sidebar
   ============================================================================ */

.sidebar {
  width: 60px;
  background: var(--color-bg-secondary);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--spacing-md) 0;
  z-index: 20;
}

.sidebar-button {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--color-text-secondary);
  border-radius: var(--radius-md);
  cursor: pointer;
  margin-bottom: var(--spacing-sm);
  transition: all var(--transition-fast);
}

.sidebar-button:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.sidebar-button.active {
  background: var(--color-accent-primary);
  color: white;
}

/* ============================================================================
   Title Bar
   ============================================================================ */

.title-bar {
  height: 32px;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--spacing-md);
  -webkit-app-region: drag;
}

.title-bar-title {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.title-bar-controls {
  display: flex;
  gap: var(--spacing-xs);
  -webkit-app-region: no-drag;
}

.title-bar-button {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
}

.title-bar-button.close { background: #ff5f57; }
.title-bar-button.minimize { background: #febc2e; }
.title-bar-button.maximize { background: #28c840; }

/* ============================================================================
   Status Bar
   ============================================================================ */

.status-bar {
  height: 24px;
  background: var(--color-bg-secondary);
  border-top: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--spacing-md);
  font-size: 11px;
  color: var(--color-text-tertiary);
}

/* ============================================================================
   Scrollbar
   ============================================================================ */

::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-full);
}

::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-tertiary);
}

/* ============================================================================
   Animations
   ============================================================================ */

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideIn {
  from { transform: translateY(10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.animate-pulse { animation: pulse 2s ease-in-out infinite; }
.animate-spin { animation: spin 1s linear infinite; }
.animate-fade-in { animation: fadeIn var(--transition-normal); }
.animate-slide-in { animation: slideIn var(--transition-normal); }
```

---

## Performance Optimization

### FPS Monitor (`src/renderer/utils/performance.ts`)

```typescript
export class FPSMonitor {
  private frames: number[] = [];
  private lastTime = performance.now();
  private fps = 60;

  update(): number {
    const now = performance.now();
    const delta = now - this.lastTime;
    this.lastTime = now;

    this.frames.push(1000 / delta);

    // Keep last 60 frames
    if (this.frames.length > 60) {
      this.frames.shift();
    }

    // Calculate average
    this.fps = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;

    return this.fps;
  }

  getFPS(): number {
    return Math.round(this.fps);
  }

  isLowFPS(): boolean {
    return this.fps < 30;
  }
}
```

### Adaptive Quality Hook (`src/renderer/hooks/useAdaptiveQuality.ts`)

```typescript
import { useEffect, useRef } from 'react';
import { useAtlasStore } from '../stores/atlasStore';
import { FPSMonitor } from '../utils/performance';

export function useAdaptiveQuality() {
  const { qualityPreset, setQualityPreset } = useAtlasStore();
  const fpsMonitor = useRef(new FPSMonitor());
  const lowFPSCount = useRef(0);

  useEffect(() => {
    if (qualityPreset !== 'auto') return;

    const checkFPS = () => {
      const fps = fpsMonitor.current.update();

      if (fps < 30) {
        lowFPSCount.current++;

        if (lowFPSCount.current > 60) {
          // Sustained low FPS, reduce quality
          setQualityPreset('low');
          lowFPSCount.current = 0;
        }
      } else {
        lowFPSCount.current = Math.max(0, lowFPSCount.current - 1);
      }

      requestAnimationFrame(checkFPS);
    };

    const frameId = requestAnimationFrame(checkFPS);
    return () => cancelAnimationFrame(frameId);
  }, [qualityPreset, setQualityPreset]);
}
```

---

## Testing

### Orb Tests (`tests/orb.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { aizawaAttractor, lorenzAttractor, thomasAttractor } from '../src/renderer/components/orb/Attractor';
import { Vector3 } from 'three';

describe('Attractors', () => {
  describe('Aizawa Attractor', () => {
    it('should produce deterministic results', () => {
      const result1 = aizawaAttractor(0.1, 0, 0, 0.01);
      const result2 = aizawaAttractor(0.1, 0, 0, 0.01);

      expect(result1.x).toBeCloseTo(result2.x);
      expect(result1.y).toBeCloseTo(result2.y);
      expect(result1.z).toBeCloseTo(result2.z);
    });

    it('should remain bounded', () => {
      let pos = new Vector3(0.1, 0, 0);

      for (let i = 0; i < 10000; i++) {
        pos = aizawaAttractor(pos.x, pos.y, pos.z, 0.01);
      }

      expect(Math.abs(pos.x)).toBeLessThan(10);
      expect(Math.abs(pos.y)).toBeLessThan(10);
      expect(Math.abs(pos.z)).toBeLessThan(10);
    });
  });

  describe('Lorenz Attractor', () => {
    it('should produce chaotic behavior', () => {
      const pos1 = lorenzAttractor(1, 1, 1, 0.01);
      const pos2 = lorenzAttractor(1.001, 1, 1, 0.01);

      // Small differences should lead to divergence over time
      let p1 = new Vector3(pos1.x, pos1.y, pos1.z);
      let p2 = new Vector3(pos2.x, pos2.y, pos2.z);

      for (let i = 0; i < 1000; i++) {
        const next1 = lorenzAttractor(p1.x, p1.y, p1.z, 0.01);
        const next2 = lorenzAttractor(p2.x, p2.y, p2.z, 0.01);
        p1.copy(next1);
        p2.copy(next2);
      }

      const distance = p1.distanceTo(p2);
      expect(distance).toBeGreaterThan(1);
    });
  });
});
```

---

## Performance Targets

| Metric | Target |
|--------|--------|
| Orb framerate | 60fps stable |
| Particle render time | <5ms/frame |
| Panel transition | <300ms |
| Memory usage (renderer) | <200MB |
| Initial render | <500ms |
| State transition | <100ms |

---

## Dependencies

```json
{
  "dependencies": {
    "@react-three/fiber": "^8.15.19",
    "@react-three/drei": "^9.92.7",
    "@react-three/postprocessing": "^2.16.0",
    "three": "^0.160.0",
    "zustand": "^4.4.7"
  }
}
```

---

**Last Updated**: 2026-01-15
