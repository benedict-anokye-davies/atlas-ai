# Nova Phase 2 Roadmap - Complete Voice AI with Personality

##  Phase 1 Complete: Audio-Reactive Attractors (Claude Code)

The orb visualization is **COMPLETE**! Nova now has a living, breathing presence that morphs through 5 strange attractors based on AI states with full audio reactivity.

**Completed Features:**
- [DONE] 5 Strange attractors (Lorenz, Thomas, Aizawa, Halvorsen, Arneodo)
- [DONE] Smooth morphing between states (1.2s transitions)
- [DONE] Audio-reactive shaders (amplitude, bass, treble, pulse)
- [DONE] Web Audio API integration hook ready
- [DONE] Transparent canvas, airy dust particles
- [DONE] Comprehensive documentation

**What Works Right Now:**
- Say "Hey Nova" → Orb morphs to Thomas (listening, green, compact)
- AI processes → Orb morphs to Aizawa (thinking, purple, swirling)
- AI responds → Orb morphs to Halvorsen (speaking, gold, pulsing)
- Returns to Lorenz (idle, cyan, butterfly) when done

##  Phase 2: Transform Nova into a Full Voice Assistant

### Current Gaps

1. **Audio Simulation** - Orb pulses with simulated audio, not real TTS output
2. **No Personality** - Generic LLM responses, no consistent character
3. **Basic Voice Pipeline** - Wake word/VAD works but needs refinement
4. **No Memory** - Can't remember previous conversations
5. **Limited Settings** - No personality customization UI

### Phase 2 Goals

Make Nova a **personality-driven voice AI** that you can have natural conversations with inside a living, reactive orb.

---

## Terminal Assignments

### TERMINAL_1: Real Audio Integration 

**Priority:** HIGH
**Session:** 027
**Estimated Time:** 4-6 hours

**What to Build:**
- Stream TTS audio from Electron main → renderer
- Connect `useAudioAnalysis` hook to real audio element
- Replace simulated audio features with live FFT analysis
- Make orb truly pulse with Nova's voice

**Key Files:**
- `src/main/tts/manager.ts` - Add audio streaming
- `src/renderer/App.tsx` - Add `<audio>` element + analysis
- `src/shared/types/index.ts` - Add IPC types

**Deliverable:** Orb reacts to real TTS audio in real-time

---

### TERMINAL_2: AI Personality System 

**Priority:** HIGH
**Session:** 028
**Estimated Time:** 6-8 hours

**What to Build:**
- Define Nova's personality traits (friendliness, humor, curiosity, energy, etc.)
- Create personality-aware system prompts for LLM
- Add emotional responses and catchphrases
- Build personality configuration UI in Settings
- Make responses feel warm, engaging, and consistent

**Key Files:**
- `src/shared/types/personality.ts` - Personality types
- `src/main/agent/personality-manager.ts` - Personality system
- `src/main/llm/manager.ts` - Integrate with LLM
- `src/renderer/components/Settings.tsx` - UI sliders

**Deliverable:** Nova has a consistent, configurable personality

**Example Personality:**
```
Name: Nova
Friendliness: 90%
Formality: 30% (casual, uses contractions)
Humor: 70% (witty, occasional puns)
Curiosity: 90% (asks follow-up questions)
Energy: 80% (enthusiastic but not overwhelming)

Greeting: "Hey there! I'm Nova  What's on your mind today?"
Response: "Oh, that's fascinating! *swirls particles thoughtfully* Here's what I think..."
```

---

### TERMINAL_3: Enhanced Voice Pipeline & Memory ️

**Priority:** MEDIUM
**Session:** 029
**Estimated Time:** 6-8 hours

**What to Build:**
- Improve wake word detection (visual feedback, confidence threshold)
- Add adaptive VAD (longer timeout for complex questions)
- Create conversation memory system (last 50 turns)
- Remember user preferences
- Add conversation stats to UI

**Key Files:**
- `src/main/wakeword/manager.ts` - Enhanced wake word
- `src/main/stt/manager.ts` - Adaptive VAD
- `src/main/memory/conversation-memory.ts` - Memory system
- `src/main/llm/manager.ts` - Integrate memory into context

**Deliverable:** Natural conversations with context memory

**Example Memory:**
```
User: "What's the weather?"
Nova: "It's sunny, 72°F..."

[5 minutes later]

User: "Should I wear a jacket?"
Nova: "Based on the 72° weather we talked about earlier, probably not needed!"
```

---

## Success Metrics

### Phase 2 Complete When:

1. **Real Audio Reactivity**
   - [ ] Orb pulses with actual TTS output
   - [ ] Bass/treble/pulse extracted correctly
   - [ ] No audio lag or glitches

2. **Personality Works**
   - [ ] Consistent character across conversations
   - [ ] Responses feel warm and engaging
   - [ ] Personality traits configurable in UI
   - [ ] Catchphrases appear naturally

3. **Natural Conversations**
   - [ ] Wake word detection >95% accurate
   - [ ] VAD doesn't cut off mid-sentence
   - [ ] Nova remembers last 50 conversation turns
   - [ ] Context included in responses
   - [ ] Stats visible in UI

4. **Polish**
   - [ ] All TypeScript compiles with no errors
   - [ ] Tests pass
   - [ ] Documentation updated
   - [ ] Demo video recorded

---

## Example User Experience (Post-Phase 2)

```
User: [Opens Nova]
Nova Orb: [Gentle cyan Lorenz butterfly shape, breathing softly]

User: "Hey Nova"
Nova Orb: [Morphs to green Thomas sphere - attentive]
         [Visual pulse confirming wake word detected]

User: "What's a strange attractor?"
Nova Orb: [Morphs to purple Aizawa ribbons - thinking]
         [Particles swirl faster, more chaotic]

Nova: "Oh great question! *swirls particles thoughtfully* A strange attractor
       is a pattern in chaos theory—basically what you're seeing in my form
       right now! These shapes emerge from simple math but create complex,
       beautiful patterns. Cool, right?"

Nova Orb: [Morphs to gold Halvorsen spirals - speaking]
         [Particles pulse and expand with each word]
         [Bass frequencies drive core glow]
         [Treble adds outer shimmer]

User: "That IS cool!"
Nova: "I know right?! "
Nova Orb: [Extra bright pulse on excitement, morphs back to cyan Lorenz - idle]

[Next day]

User: "Hey Nova, remember what we talked about yesterday?"
Nova: "Yeah! We were discussing strange attractors—actually my favorite topic
       since I'm literally living inside one. Want to dive deeper?"
```

---

## Technical Architecture (Phase 2)

```
┌─────────────────────────────────────────────────────┐
│                   NOVA DESKTOP                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────┐         ┌──────────────┐         │
│  │ RENDERER     │◄───IPC──┤ MAIN PROCESS │         │
│  └──────────────┘         └──────────────┘         │
│        │                         │                  │
│        ▼                         ▼                  │
│  ┌──────────────┐         ┌──────────────┐         │
│  │ NovaOrbAttr  │         │ TTS Manager  │         │
│  │ (3D Visual)  │◄────────┤ (Audio Out)  │         │
│  └──────────────┘         └──────────────┘         │
│        │                         │                  │
│        │                         ▼                  │
│        │                  ┌──────────────┐         │
│        │                  │ Personality  │         │
│        │                  │   Manager    │         │
│        │                  └──────────────┘         │
│        │                         │                  │
│        │                         ▼                  │
│        │                  ┌──────────────┐         │
│        │                  │ LLM Manager  │         │
│        │                  │ + Memory     │         │
│        │                  └──────────────┘         │
│        │                         │                  │
│        ▼                         ▼                  │
│  ┌──────────────┐         ┌──────────────┐         │
│  │ Web Audio    │         │ Wake Word +  │         │
│  │   Analysis   │         │     VAD      │         │
│  └──────────────┘         └──────────────┘         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## Timeline Estimate

| Phase | Duration | Status |
|-------|----------|--------|
| **Phase 1**: Audio-Reactive Attractors | 2-3 hours | [DONE] COMPLETE |
| **Terminal 1**: Real Audio Integration | 4-6 hours | 🟡 READY |
| **Terminal 2**: Personality System | 6-8 hours | 🟡 READY |
| **Terminal 3**: Voice Pipeline + Memory | 6-8 hours | 🟡 READY |
| **Polish & Testing** | 2-4 hours | [PENDING] PENDING |
| **Total Phase 2** | ~20-28 hours | |

---

## Resources

- **Phase 1 Documentation**: `docs/AUDIO_REACTIVE_ATTRACTORS.md`
- **Quick Start Guide**: `ATTRACTOR_QUICK_START.md`
- **Session History**: `SESSIONS.md`
- **Codebase Status**: `docs/DEVELOPMENT_STATUS.md`

---

## After Phase 2: Future Enhancements

**Phase 3 Ideas:**
- 🌐 Multi-language support
- 🎵 Music playback with attractor visualization
-  Knowledge graph visualization
- 🎮 Interactive attractor editor
-  Real-time beat detection (not simulated)
-  Advanced sentiment-based attractor blending
- 👋 Gesture control with hand tracking
- 🌌 VR/AR support with spatial audio

---

**Let's make Nova truly alive!** 🌟

Coordinator: Claude Code Agent (session-026)
Date: 2026-01-14
Status: Phase 2 Ready for Implementation
