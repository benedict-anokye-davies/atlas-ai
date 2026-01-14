# Audio-Reactive Strange Attractor System

## Overview

Nova's particle orb is a living, breathing AI presence that morphs through 5 different strange attractors based on AI states. The orb pulses, expands, and reacts to audio (TTS output) in real-time, making the AI literally "speak through" the visualization.

## Architecture

### Component Hierarchy

```
App.tsx
├── NovaOrbAttractor (Canvas wrapper)
    └── NovaParticlesAttractors (Particle system)
        ├── Strange Attractor Generation
        ├── Morphing System
        └── Audio-Reactive Shaders
```

### State → Attractor Mapping

| AI State    | Attractor  | Characteristics                    | Color         |
| ----------- | ---------- | ---------------------------------- | ------------- |
| `idle`      | Lorenz     | Calm butterfly shape, gentle flow  | Cyan/Teal     |
| `listening` | Thomas     | Compact, attentive, focused        | Green         |
| `thinking`  | Aizawa     | Dense, concentrated, swirling      | Purple/Violet |
| `speaking`  | Halvorsen  | Expansive, warm, pulsing with audio| Gold/Orange   |
| `error`     | Arneodo    | Chaotic, agitated, alert           | Red/Crimson   |

## Audio Reactivity

### Audio Features Extracted

The system extracts 4 key audio features for visualization:

1. **Amplitude** (0-1): Overall volume/energy
2. **Bass** (0-1): Low frequency content (0-5kHz)
3. **Treble** (0-1): High frequency content (15-22kHz)
4. **Pulse** (0-1): Rhythmic wave synchronized with speech

### Visual Mappings

| Audio Feature | Visual Effect                                    |
| ------------- | ------------------------------------------------ |
| Amplitude     | Particle expansion, brightness, overall scale    |
| Bass          | Core glow intensity, turbulence strength         |
| Treble        | Outer shimmer, particle size variation           |
| Pulse         | Rhythmic wave propagating through particles      |

### Shader Implementation

The vertex shader applies audio reactivity:

```glsl
// Pulse wave propagates outward from center
float wave = sin(dist * 2.0 - uTime * 3.0 + uPulse * 6.28) * 0.5 + 0.5;
float audioDisplace = uAudioLevel * wave * 0.3;

// Bass affects turbulence
float turbulenceAmount = uTurbulence * (1.0 + uBass * 0.8);

// Treble affects particle size
float sizePulse = 1.0 + uAudioLevel * 0.3 + uTreble * 0.2;

// Combined expansion
float totalExpansion = breathe * uExpansion * (1.0 + audioDisplace);
```

## Morphing System

### How Morphing Works

1. **State Change Detected**: App.tsx detects AI state transition
2. **Generate Target Attractor**: New particle positions calculated
3. **Smooth Interpolation**: Positions morph over 1.2 seconds using ease-in-out cubic
4. **Shader Uniforms Update**: Colors, speeds, and effects transition simultaneously

### Morph Implementation

```typescript
// Generate target positions
targetDataRef.current = generateParticleData(particleCount, targetAttractor);

// Smooth morph with easing
const smoothProgress = t < 0.5
  ? 4 * t * t * t
  : 1 - Math.pow(-2 * t + 2, 3) / 2;

// Interpolate positions
const morphedPositions = morphPositions(currentPositions, targetPositions, smoothProgress);
```

## Integration Guide

### Using the Audio-Reactive Orb

```tsx
import { NovaOrbAttractor } from './components/orb';
import type { AudioFeatures } from './hooks';

function MyComponent() {
  const audioFeatures: AudioFeatures = {
    amplitude: 0.5, // 0-1
    bass: 0.3,      // 0-1
    treble: 0.4,    // 0-1
    pulse: 0.6,     // 0-1
  };

  return (
    <NovaOrbAttractor
      state="speaking"           // idle | listening | thinking | speaking | error
      audioFeatures={audioFeatures}
      particleCount={8000}       // More = denser, but slower
      interactive={true}         // Enable orbit controls
      onStateClick={() => {...}} // Click handler
    />
  );
}
```

### Integrating Real TTS Audio

To connect real TTS audio from Electron main process:

#### Option 1: Web Audio API (Recommended)

```typescript
import { useAudioAnalysis } from './hooks';

function MyComponent() {
  // Get reference to audio element playing TTS
  const audioElement = document.getElementById('tts-audio') as HTMLAudioElement;

  // Hook automatically analyzes audio
  const audioFeatures = useAudioAnalysis(audioElement, {
    fftSize: 256,
    smoothingTimeConstant: 0.8,
    enabled: true,
  });

  return <NovaOrbAttractor state="speaking" audioFeatures={audioFeatures} />;
}
```

#### Option 2: IPC from Main Process

If TTS audio is in main process, send analysis via IPC:

**Main Process:**
```typescript
// In TTS manager
import { BrowserWindow } from 'electron';

// During TTS playback, analyze audio and send to renderer
function sendAudioFeatures(features: AudioFeatures) {
  const win = BrowserWindow.getFocusedWindow();
  win?.webContents.send('nova:audio-features', features);
}
```

**Renderer Process:**
```typescript
import { useState, useEffect } from 'react';

function useIPCAudioFeatures() {
  const [features, setFeatures] = useState<AudioFeatures>({
    amplitude: 0, bass: 0, treble: 0, pulse: 0
  });

  useEffect(() => {
    const unsubscribe = window.nova?.on('nova:audio-features', setFeatures);
    return () => unsubscribe?.();
  }, []);

  return features;
}
```

## Performance Optimization

### Particle Count Guidelines

| Particle Count | Performance | Visual Quality | Use Case                    |
| -------------- | ----------- | -------------- | --------------------------- |
| 3,000-5,000    | Excellent   | Good           | Low-end hardware, mobile    |
| 8,000-10,000   | Good        | Excellent      | Default, balanced           |
| 15,000-20,000  | Fair        | Outstanding    | High-end desktop, showcase  |

### Optimization Tips

1. **Reduce FFT Size**: Use 128 or 256 for audio analysis (default: 256)
2. **Throttle Updates**: Audio features update at ~60fps, already optimized
3. **Disable Auto-Rotate**: Set `interactive={false}` if not needed
4. **Use Simpler Attractors**: Lorenz/Thomas are faster than Aizawa
5. **Lower Smoothing**: Reduce `smoothingTimeConstant` for faster response

## Attractor Mathematics

### Lorenz (Idle State)

```typescript
const sigma = 10, rho = 28, beta = 8/3;
dx/dt = sigma * (y - x)
dy/dt = x * (rho - z) - y
dz/dt = x * y - beta * z
```

Classic butterfly attractor. Parameters tuned for calm, balanced motion.

### Thomas (Listening State)

```typescript
const b = 0.208186;
dx/dt = sin(y) - b * x
dy/dt = sin(z) - b * y
dz/dt = sin(x) - b * z
```

Compact, symmetrical. Creates an attentive, focused appearance.

### Aizawa (Thinking State)

```typescript
const a=0.95, b=0.7, c=0.6, d=3.5, e=0.25, f=0.1;
dx/dt = (z - b) * x - d * y
dy/dt = d * x + (z - b) * y
dz/dt = c + a*z - z³/3 - (x²+y²)(1+e*z) + f*z*x³
```

Dense, flowing ribbons. Represents active processing/computation.

### Halvorsen (Speaking State)

```typescript
const a = 1.89;
dx/dt = -a*x - 4*y - 4*z - y²
dy/dt = -a*y - 4*z - 4*x - z²
dz/dt = -a*z - 4*x - 4*y - x²
```

Expansive 3D spirals. Warm, expressive, pairs with speech audio.

### Arneodo (Error State)

```typescript
const a=-5.5, b=3.5, c=-1;
dx/dt = y
dy/dt = z
dz/dt = -a*x - b*y - z + c*x³
```

Chaotic, agitated. Sharp transitions convey alert/error state.

## Shader Uniforms Reference

| Uniform           | Type  | Range  | Description                          |
| ----------------- | ----- | ------ | ------------------------------------ |
| `uTime`           | float | 0+     | Elapsed time for animations          |
| `uState`          | float | 0-4    | AI state (idle=0, listening=1, etc.) |
| `uAudioLevel`     | float | 0-1    | Overall audio amplitude              |
| `uBass`           | float | 0-1    | Low frequency energy                 |
| `uTreble`         | float | 0-1    | High frequency energy                |
| `uPulse`          | float | 0-1    | Rhythmic pulse wave                  |
| `uExpansion`      | float | 0.8-1.5| Scale multiplier (audio-driven)      |
| `uSpeedMultiplier`| float | 0.3-2.5| Animation speed per state            |
| `uTurbulence`     | float | 0-0.6  | Curl noise intensity                 |
| `uGlowIntensity`  | float | 0.8-2.0| Particle brightness                  |
| `uStateColor`     | vec3  | RGB    | Current state color                  |
| `uColorMix`       | float | 0-1    | Blend to state color                 |
| `uMorphProgress`  | float | 0-1    | Attractor morph interpolation        |

## Troubleshooting

### Orb Not Morphing Between States

**Cause**: State prop not changing or attractor names misconfigured.

**Fix**: Check `STATE_TO_ATTRACTOR` mapping in `attractors.ts`.

### No Audio Reactivity

**Cause**: Audio features are all zeros.

**Fix**:
1. Verify TTS audio is playing
2. Check Web Audio API connection
3. Enable browser audio permissions
4. Use simulated features for testing (see App.tsx)

### Poor Performance / Low FPS

**Cause**: Too many particles or expensive shaders.

**Fix**:
1. Reduce `particleCount` to 5000
2. Disable auto-rotation
3. Lower FFT size in audio analysis
4. Check GPU/WebGL support

### Particles Look Like a Blob

**Cause**: Shader size attenuation too high or particles too large.

**Fix**: Already fixed in current shaders (50.0 attenuation, 0.5-4.0 clamp).

## Future Enhancements

- [ ] Real-time beat detection for pulse wave
- [ ] Gesture control with hand tracking
- [ ] Emotion mapping (sentiment analysis → attractor blend)
- [ ] User-definable custom attractors
- [ ] VR/AR support with spatial audio
- [ ] Recording/playback of morph sequences
- [ ] Multi-attractor blending (not just binary morphs)

## References

- [Strange Attractors - Wolfram MathWorld](http://mathworld.wolfram.com/StrangeAttractor.html)
- [Web Audio API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Three.js Custom Shaders](https://threejs.org/docs/#api/en/materials/ShaderMaterial)
- [Curl Noise for Particle Flow](https://petewerner.blogspot.com/2015/02/intro-to-curl-noise.html)

---

**Built with**: Three.js 0.160.0, React Three Fiber 8.15.19, Web Audio API

**License**: MIT

**Author**: Nova Development Team + Claude Code Agent
