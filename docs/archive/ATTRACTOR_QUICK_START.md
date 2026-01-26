# Nova Audio-Reactive Attractors - Quick Start Guide

## What You Got

Nova's particle orb now **morphs between 5 strange attractors** based on AI state and **pulses with audio**. The AI literally "speaks through" the visualization.

## Try It Now

```bash
npm run dev
```

Then trigger different states:
- Say "Hey Nova" → **Thomas attractor** (listening, green, compact)
- Ask a question → **Aizawa attractor** (thinking, purple, swirling)
- Wait for response → **Halvorsen attractor** (speaking, gold, pulsing)
- Idle → **Lorenz attractor** (calm, cyan, butterfly)
- Error → **Arneodo attractor** (agitated, red, chaotic)

## Key Files

| File | What It Does |
|------|-------------|
| `NovaOrbAttractor.tsx` | Main orb component (use this) |
| `NovaParticles_Attractors.tsx` | Particle system with morphing |
| `attractors.ts` | 5 attractor equations + mappings |
| `geometry.ts` | Point generation + morphing math |
| `shaders.ts` | Audio-reactive GLSL shaders |
| `useAudioAnalysis.ts` | Web Audio API hook |
| `App.tsx` | Integration (simulated audio for now) |

## Usage

```tsx
import { NovaOrbAttractor } from './components/orb';

<NovaOrbAttractor
  state="speaking"  // Changes attractor shape
  audioFeatures={{  // Makes it pulse/react
    amplitude: 0.5,  // Overall volume
    bass: 0.3,       // Low frequencies
    treble: 0.4,     // High frequencies
    pulse: 0.6       // Rhythmic wave
  }}
  particleCount={8000}  // More = prettier, slower
  interactive={true}    // Enable camera rotation
/>
```

## Attractor Shapes

```
IDLE (Lorenz)        LISTENING (Thomas)    THINKING (Aizawa)
    ∞                      ○                     ∿∿∿
  Butterfly              Sphere              Ribbon Flow

SPEAKING (Halvorsen)  ERROR (Arneodo)
      ⟳⟲                    
   Spiral Dance           Chaos Spikes
```

## Audio Reactivity

Right now, audio features are **simulated** in App.tsx based on state:
- `speaking` → dynamic pulsing (sine waves + random)
- `thinking` → subtle energy
- Other states → silent

### Connect Real Audio (Future)

To use real TTS audio:

```tsx
import { useAudioAnalysis } from './hooks';

// Option 1: Direct audio element
const audioEl = document.getElementById('tts-audio');
const audioFeatures = useAudioAnalysis(audioEl);

// Option 2: By element ID
const audioFeatures = useGlobalAudioAnalysis('tts-audio');

<NovaOrbAttractor audioFeatures={audioFeatures} />
```

See `docs/AUDIO_REACTIVE_ATTRACTORS.md` for full integration guide.

## Performance Tuning

| Setting | Fast | Balanced | Beautiful |
|---------|------|----------|-----------|
| Particle Count | 3,000 | 8,000 | 20,000 |
| FPS Target | 60+ | 60 | 45-60 |

Change in Settings UI or via prop:
```tsx
<NovaOrbAttractor particleCount={5000} />
```

## Troubleshooting

**Problem**: Orb not changing shape when state changes
**Fix**: Check that `state` prop is actually changing (check DevTools)

**Problem**: No audio reactivity
**Fix**: Audio features are simulated right now - check App.tsx lines 35-57

**Problem**: Particles look like a blob
**Fix**: Already fixed! Canvas is transparent, particles are small (0.5-4.0 px)

**Problem**: Slow/laggy
**Fix**: Reduce `particleCount` to 5000 or 3000

## What's New vs Original Orb

| Feature | Old NovaOrb | New NovaOrbAttractor |
|---------|-------------|----------------------|
| Particle distribution | Fixed spheres/rings | Dynamic strange attractors |
| State transitions | Color change only | **Full shape morph** |
| Audio reactivity | Basic amplitude | **Bass/Treble/Pulse** |
| Background | Black box | **Transparent** |
| Particle sizes | 1-20px (too big) | **0.5-4px** (airy dust) |
| Animation | Static rotation | **Curl noise + state-based speed** |

## Architecture

```
App.tsx
  └─ NovaOrbAttractor (Canvas + Controls)
      └─ NovaParticlesAttractors (Particle System)
          ├─ Generate attractor points (8000 particles)
          ├─ Morph between attractors (1.2s smooth)
          └─ Render with audio-reactive shaders
              ├─ Vertex: Position + curl noise + audio expansion
              └─ Fragment: Glow + color + state blending
```

## State Machine

```
State Change → Target Attractor Selected → Generate New Points
                                               ↓
      Morph Complete ← Interpolate Positions ← Start Morph
            ↓
     Update Current → Swap Data → Resume Animation
```

## Next Steps

1. **Test it**: Run `npm run dev` and trigger different states
2. **Tweak it**: Adjust `particleCount` in Settings UI
3. **Integrate TTS audio**: Follow guide in `AUDIO_REACTIVE_ATTRACTORS.md`
4. **Customize attractors**: Edit parameters in `attractors.ts`

## Full Documentation

See `docs/AUDIO_REACTIVE_ATTRACTORS.md` for:
- Complete API reference
- Audio integration guides (Web Audio API + IPC)
- Attractor mathematics
- Shader uniform details
- Performance optimization
- Troubleshooting

---

Built by Claude Code Agent (session-026) 
