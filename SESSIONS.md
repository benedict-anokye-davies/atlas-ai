# Nova Multi-Session Coordination

## 📋 MASTER PLAN OVERVIEW

**Total Phases:** 8 | **Total Sessions:** 51 (027-077) | **Estimated Hours:** ~150-200

Each session is broken into **2-3 hour chunks**. When you complete a chunk, **immediately move to the next session in your queue**.

---

## 🚦 ACTIVE SESSIONS

| Terminal    | Session | Status | Current Task         | Files Locked | Last Updated |
| ----------- | ------- | ------ | -------------------- | ------------ | ------------ |
| COORDINATOR | -       | ACTIVE | Coordination         | sessions.md  | 2026-01-14   |
| 1           | 030-B   | READY  | Dynamic LOD System   | (available)  | 2026-01-14   |
| 2           | 028-C   | READY  | LLM Integration & UI | (available)  | 2026-01-14   |
| 3           | 032-A   | READY  | Circuit Breaker      | (available)  | 2026-01-14   |

---

## ✅ COMPLETED SESSIONS

| Session | Task                             | Completed                         |
| ------- | -------------------------------- | --------------------------------- |
| 022     | Fix Postprocessing + Vite        | 2026-01-14                        |
| 023     | Memory Integration               | 2026-01-14                        |
| 024     | Security Hardening               | 2026-01-14                        |
| 025     | ~~Orb Visualization Fix~~        | **CANCELLED** (superseded by 026) |
| 026     | Attractor System + Vision Docs   | 2026-01-14                        |
| 027-A   | TTS Audio Streaming              | 2026-01-14                        |
| 027-B   | Renderer Audio Element           | 2026-01-14                        |
| 027-C   | Real Audio Analysis              | 2026-01-14                        |
| 028-A   | Personality Types & Config       | 2026-01-14                        |
| 028-B   | Personality Manager              | 2026-01-14                        |
| 029-A   | Wake Word Detection Improvements | 2026-01-14                        |
| 029-B   | VAD Improvements                 | 2026-01-14                        |
| 029-C   | Conversation Memory              | 2026-01-14                        |
| 030-A   | FPS Counter & Monitoring         | 2026-01-14                        |
| 032-A   | Circuit Breaker Pattern          | 2026-01-14 (pre-existing)         |
| 032-B   | Retry with Exponential Backoff   | 2026-01-14 (pre-existing)         |
| 032-C   | User-Friendly Error Toasts       | 2026-01-14                        |

---

## 📊 PHASE OVERVIEW

| Phase | Focus                    | Sessions            | Hours | Status        |
| ----- | ------------------------ | ------------------- | ----- | ------------- |
| **2** | Core Voice & Personality | 027-029 (9 chunks)  | 18-27 | **READY NOW** |
| **3** | Performance & Resilience | 030-033 (12 chunks) | 24-36 | Planned       |
| **4** | Advanced Voice & Memory  | 034-037 (12 chunks) | 24-36 | Planned       |
| **5** | UX & Onboarding          | 038-041 (12 chunks) | 24-36 | Planned       |
| **6** | Intelligence & Skills    | 042-045 (12 chunks) | 24-36 | Planned       |
| **7** | Platform & Security      | 046-049 (12 chunks) | 24-36 | Planned       |
| **8** | Testing & Release        | 050-053 (12 chunks) | 24-36 | Planned       |

---

## 🎯 TERMINAL ASSIGNMENT QUEUES

### TERMINAL 1 QUEUE (Performance & Intelligence Focus)

```
Phase 2: 027-A → 027-B → 027-C
Phase 3: 030-A → 030-B → 030-C → 033-A → 033-B → 033-C
Phase 4: 034-A → 034-B → 034-C → 037-A → 037-B → 037-C
Phase 5: 038-A → 038-B → 038-C → 041-A → 041-B → 041-C
Phase 6: 042-A → 042-B → 042-C → 045-A → 045-B → 045-C
Phase 7: 046-A → 046-B → 046-C → 049-A → 049-B → 049-C
Phase 8: 050-A → 050-B → 050-C → 050-D
```

### TERMINAL 2 QUEUE (Personality & UX Focus)

```
Phase 2: 028-A → 028-B → 028-C
Phase 3: 031-A → 031-B → 031-C
Phase 4: 035-A → 035-B → 035-C
Phase 5: 039-A → 039-B → 039-C
Phase 6: 043-A → 043-B → 043-C
Phase 7: 047-A → 047-B → 047-C
Phase 8: 051-A → 051-B → 051-C
```

### TERMINAL 3 QUEUE (Voice & Infrastructure Focus)

```
Phase 2: 029-A → 029-B → 029-C
Phase 3: 032-A → 032-B → 032-C
Phase 4: 036-A → 036-B → 036-C
Phase 5: 040-A → 040-B → 040-C
Phase 6: 044-A → 044-B → 044-C
Phase 7: 048-A → 048-B → 048-C
Phase 8: 052-A → 052-B → 052-C
```

---

# ═══════════════════════════════════════════════════════════════

# PHASE 2: CORE VOICE & PERSONALITY (START HERE!)

# ═══════════════════════════════════════════════════════════════

## TERMINAL 1: Session 027 - Real Audio Integration 🔊

### 027-A: TTS Audio Streaming (2-3 hours)

**Status:** ✅ COMPLETED
**Goal:** Stream TTS audio from main process to renderer

**Tasks:**

1. Modify `src/main/tts/manager.ts`:
   - Add method to convert audio buffer to base64 data URL
   - Send audio via IPC channel `nova:tts-audio`
2. Update `src/main/ipc/handlers.ts`:
   - Register the `nova:tts-audio` channel
3. Update `src/shared/types/index.ts`:
   - Add TTS audio event type

**Code to add in `src/main/tts/manager.ts`:**

```typescript
private async streamAudioToRenderer(audioData: Buffer): Promise<void> {
  const mainWindow = BrowserWindow.getFocusedWindow();
  if (!mainWindow) return;

  const base64 = audioData.toString('base64');
  const dataUrl = `data:audio/wav;base64,${base64}`;
  mainWindow.webContents.send('nova:tts-audio', dataUrl);
}
```

**Success:** IPC channel sends audio data URL to renderer
**Next:** Move to 027-B

---

### 027-B: Renderer Audio Element (2-3 hours)

**Status:** ✅ COMPLETED
**Goal:** Create audio element and connect to Web Audio API

**Tasks:**

1. Modify `src/renderer/App.tsx`:
   - Add hidden `<audio>` element
   - Listen for `nova:tts-audio` IPC event
   - Set audio src and play
2. Connect `useAudioAnalysis` hook to audio element

**Code to add in `src/renderer/App.tsx`:**

```tsx
const audioRef = useRef<HTMLAudioElement>(null);

useEffect(() => {
  const handleTTSAudio = (dataUrl: string) => {
    if (audioRef.current) {
      audioRef.current.src = dataUrl;
      audioRef.current.play();
    }
  };
  const unsubscribe = window.nova?.on('nova:tts-audio', handleTTSAudio);
  return () => unsubscribe?.();
}, []);

// In JSX:
<audio ref={audioRef} id="nova-tts-audio" style={{ display: 'none' }} />;
```

**Success:** Audio plays through hidden element
**Next:** Move to 027-C

---

### 027-C: Real Audio Analysis (2-3 hours)

**Status:** ✅ COMPLETED
**Goal:** Replace simulated audio with real FFT analysis

**Tasks:**

1. Connect `useAudioAnalysis` to the audio element
2. Pass real audio features to `NovaOrbAttractor`
3. Remove simulated audio code
4. Test end-to-end: Say something → hear response → see orb react

**Test:**

```bash
npm run dev
# Say "Hey Nova, how are you?"
# Verify orb pulses with Nova's voice
```

**Success Criteria:**

- [x] Orb reacts to real TTS audio
- [x] Bass/treble separation works
- [x] No audio glitches or lag
- [x] Falls back gracefully if audio unavailable

**Next:** Move to Phase 3 → Session 030-A

---

## TERMINAL 2: Session 028 - AI Personality System 🤖

### 028-A: Personality Types & Config (2-3 hours)

**Status:** ✅ COMPLETED
**Goal:** Define personality types and default configuration

**Completed Tasks:**

1. Created `src/shared/types/personality.ts`:
   - **PersonalityTraits interface:** 6 core traits (friendliness, formality, humor, curiosity, energy, patience) on 0-1 scale
   - **PersonalityConfig interface:** Full config with name, archetype, traits, emotional responses, catchphrases, actions, responseStyle
   - **EmotionalResponses:** 8 Nova emotions (happy, sad, confused, excited, thinking, empathetic, playful, focused)
   - **UserEmotion type:** 6 user emotions (happy, sad, neutral, angry, excited, frustrated)
   - **4 Preset Personalities:** nova (default), professional, playful, minimal
   - **DEFAULT_NOVA_PERSONALITY:** Warm/curious (friendliness: 0.9, humor: 0.7, energy: 0.8)
   - **PartialPersonalityConfig:** Interface for partial updates with optional nested fields

2. Updated `src/shared/types/index.ts` to export personality types

**Success:** Types compile, default config defined
**Next:** Move to 028-B

---

### 028-B: Personality Manager (2-3 hours)

**Status:** ✅ COMPLETED
**Goal:** Create personality engine

**Completed Tasks:**

1. Created `src/main/agent/personality-manager.ts`:
   - **PersonalityManager class** with EventEmitter support
   - **getSystemPrompt(additionalContext?)** - Generates LLM system prompt from personality traits
   - **enhanceResponse(response, emotion?)** - Adds emotional flavor/catchphrases to responses
   - **detectUserEmotion(text)** - Returns `{emotion, confidence}` using regex patterns with priority scoring
   - **detectResponseEmotion(response)** - Returns `{emotion, voiceState}` for visualization with scoring
   - **mapUserEmotionToResponse(userEmotion)** - Maps user emotion to appropriate Nova response
   - **setPreset(preset)** / **setTrait(trait, value)** - Configuration management
   - **getGreeting()** / **getFarewell()** / **getCatchphrase()** - Personality flavor text
   - **Singleton pattern:** `getPersonalityManager()`, `shutdownPersonalityManager()`, `resetPersonalityManager()`
   - **Events:** `preset-changed`, `trait-updated`, `user-emotion`, `response-emotion`

2. Created `tests/personality.test.ts`:
   - 69 tests covering types, manager, emotion detection, presets, integration
   - All tests passing

**Success:** PersonalityManager class works with full test coverage
**Next:** Move to 028-C

---

### 028-C: LLM Integration & UI (2-3 hours)

**Status:** READY
**Goal:** Integrate personality with LLM and add settings UI

**Tasks:**

1. Modify `src/main/llm/manager.ts`:
   - Import PersonalityManager
   - Use `getSystemPrompt()` in LLM calls
2. Add personality settings to `src/renderer/components/Settings.tsx`:
   - Sliders for each trait
   - Save to store

**Test:**

```bash
npm run dev
# Open settings, adjust personality
# Talk to Nova, verify personality changes
```

**Success Criteria:**

- [ ] Nova has consistent personality
- [ ] Personality traits configurable in Settings
- [ ] Responses feel natural
- [ ] System prompt adapts to settings

**Next:** Move to Phase 3 → Session 031-A

---

## TERMINAL 3: Session 029 - Voice Pipeline & Memory 🎙️

### 029-A: Wake Word Improvements (2-3 hours)

**Status:** ✅ COMPLETED
**Goal:** Improve wake word detection reliability

**Completed Tasks:**

1. Rewrote `src/main/voice/wake-word.ts` with major enhancements:
   - **Confidence thresholding** - Added `ConfidenceConfig` with `minThreshold` (0.6 default), `minAudioLevel`, adaptive thresholding based on ambient noise
   - **Visual feedback system** - New `WakeWordFeedback` interface with types: `detected`, `rejected`, `cooldown`, `listening`, `ready`
   - **IPC feedback** - `sendFeedbackToRenderer()` sends `nova:wake-feedback` events to renderer
   - **Detection statistics** - `DetectionStats` interface tracking total/accepted/rejected detections, average confidence, uptime
   - **Extended wake word event** - `ExtendedWakeWordEvent` includes `rawConfidence`, `computedConfidence`, `passedThreshold`, `audioLevel`, `ambientLevel`
   - **Ambient noise estimation** - Tracks audio level history, uses 25th percentile as ambient estimate
   - **Adaptive threshold** - In noisy environments, threshold automatically increases
   - **New methods**: `setConfidenceThreshold()`, `setConfidenceConfig()`, `setVisualFeedback()`, `getStats()`, `resetStats()`

2. Exported new types from `src/shared/types/voice.ts`:
   - `WakeWordFeedback`, `WakeWordFeedbackType`, `ConfidenceConfig`, `ExtendedWakeWordEvent`, `DetectionStats`

3. Added `nova:wake-feedback` to valid IPC channels in `src/main/preload.ts`

4. Updated `src/renderer/hooks/useNovaState.ts`:
   - Added `wakeFeedback` and `lastWakeFeedbackType` state
   - Added listener for `nova:wake-feedback` events with auto-clear after 3s

5. Updated `tests/wake-word.test.ts`:
   - Added tests for confidence thresholding
   - Added tests for confidence config
   - Added tests for visual feedback events
   - Added tests for detection statistics
   - Added tests for ambient noise level

**Success:** Wake word more reliable, visual feedback works
**Next:** Move to 029-B

---

### 029-B: VAD Improvements (2-3 hours)

**Status:** ✅ COMPLETED
**Goal:** Adaptive voice activity detection

**Completed Tasks:**

1. Enhanced `src/main/voice/vad.ts` with:
   - **Adaptive silence timeout** - `AdaptiveSilenceConfig` with `baseSilenceMs`, `incompleteSilenceMs`, `shortPauseMs`, `maxSilenceMs`
   - **Sentence ending detection** - `isCompleteSentence()`, `isIncompleteSentence()`, `isThinkingPause()` methods
   - **"Still listening" state** - `StillListeningEvent` emitted when pause detected but more speech expected
   - **Listening state machine** - `ListeningState` type: `idle`, `listening`, `hearing`, `still_listening`, `processing`
   - **Continuation word detection** - Detects words like "and", "but", "because" at end of transcript
   - **IPC events** - `nova:still-listening` and `nova:listening-state` sent to renderer
   - **Transcript integration** - `setCurrentTranscript()` method for STT to inform VAD decisions

2. Exported new types from `src/shared/types/voice.ts`:
   - `ListeningState`, `StillListeningEvent`, `AdaptiveSilenceConfig`

3. Added IPC channels to `src/main/preload.ts`:
   - `nova:still-listening`, `nova:listening-state`

4. Updated `src/renderer/hooks/useNovaState.ts`:
   - Added `listeningState` and `stillListening` state
   - Added listeners for new IPC events

**Success:** VAD adapts to conversation flow
**Next:** Move to 029-C

---

### 029-C: Conversation Memory (2-3 hours)

**Status:** ✅ COMPLETED
**Goal:** Remember conversations and context

**Completed Tasks:**

1. Created `src/main/memory/conversation-memory.ts`:
   - `ConversationTurn` interface with topics, sentiment, importance
   - `ConversationMemory` class with topic extraction
   - `getContext()` method for LLM prompt assembly
   - Preference/fact extraction from user messages
   - Integration with existing `MemoryManager`

2. Integrated with LLM Manager (`src/main/llm/manager.ts`):
   - Added `enableConversationMemory` and `maxContextTurns` config options
   - `buildEnhancedSystemPrompt()` - Builds system prompt with conversation context
   - `recordConversationTurn()` - Records turns in memory
   - Context automatically enhanced in `chat()` and `chatStream()` methods
   - Conversation turns recorded after LLM responses
   - `clearContext()` now clears conversation memory

**Success Criteria:**

- [x] Memory context included in LLM prompts
- [x] Last 50 turns remembered
- [x] Topics extracted from conversations
- [x] User preferences/facts stored
- [x] Context assembled for LLM prompts

**Next:** Move to Phase 3 → Session 032-A

---

# ═══════════════════════════════════════════════════════════════

# PHASE 3: PERFORMANCE & RESILIENCE

# ═══════════════════════════════════════════════════════════════

## TERMINAL 1: Session 030 - Adaptive Performance System ⚡

### 030-A: FPS Counter & Monitoring (2-3 hours)

**Status:** ✅ COMPLETED
**Goal:** Add real-time performance monitoring

**Tasks:**

1. Create `src/renderer/hooks/usePerformanceMonitor.ts`:

```typescript
export function usePerformanceMonitor() {
  const [fps, setFps] = useState(60);
  const [memoryUsage, setMemoryUsage] = useState(0);
  const frameCount = useRef(0);
  const lastTime = useRef(performance.now());

  useEffect(() => {
    let animationId: number;

    const measureFPS = () => {
      frameCount.current++;
      const now = performance.now();
      const delta = now - lastTime.current;

      if (delta >= 1000) {
        setFps(Math.round((frameCount.current * 1000) / delta));
        frameCount.current = 0;
        lastTime.current = now;

        // Memory (if available)
        if (performance.memory) {
          setMemoryUsage(Math.round(performance.memory.usedJSHeapSize / 1024 / 1024));
        }
      }

      animationId = requestAnimationFrame(measureFPS);
    };

    animationId = requestAnimationFrame(measureFPS);
    return () => cancelAnimationFrame(animationId);
  }, []);

  return { fps, memoryUsage };
}
```

2. Add FPS counter to debug mode in App.tsx

**Success:** FPS counter shows in dev mode
**Next:** Move to 030-B

---

### 030-B: Dynamic LOD System (2-3 hours)

**Status:** WAITING (after 030-A)
**Goal:** Auto-adjust particle count based on FPS

**Tasks:**

1. Create `src/renderer/hooks/useAdaptiveParticles.ts`:

```typescript
export function useAdaptiveParticles(targetFPS = 55) {
  const [particleCount, setParticleCount] = useState(8000);
  const { fps } = usePerformanceMonitor();
  const adjustmentCooldown = useRef(0);

  useEffect(() => {
    if (adjustmentCooldown.current > 0) {
      adjustmentCooldown.current--;
      return;
    }

    if (fps < targetFPS - 10) {
      // FPS too low, reduce particles
      setParticleCount((prev) => Math.max(2000, prev - 1000));
      adjustmentCooldown.current = 5; // Wait 5 frames
    } else if (fps > targetFPS && fps >= 58) {
      // FPS good, can increase particles
      setParticleCount((prev) => Math.min(15000, prev + 500));
      adjustmentCooldown.current = 10;
    }
  }, [fps, targetFPS]);

  return particleCount;
}
```

2. Use in NovaOrbAttractor component

**Success:** Particle count auto-adjusts to maintain FPS
**Next:** Move to 030-C

---

### 030-C: Quality Presets (2-3 hours)

**Status:** WAITING (after 030-B)
**Goal:** Add Low/Medium/High/Ultra quality presets

**Tasks:**

1. Add quality presets to settings:

```typescript
export const QUALITY_PRESETS = {
  low: { particles: 3000, effects: false, shadows: false },
  medium: { particles: 8000, effects: true, shadows: false },
  high: { particles: 12000, effects: true, shadows: true },
  ultra: { particles: 20000, effects: true, shadows: true },
};
```

2. Add quality selector to Settings UI
3. Apply presets to orb renderer

**Success Criteria:**

- [ ] FPS counter visible in dev mode
- [ ] Particle count auto-adjusts for 60fps
- [ ] Quality presets work
- [ ] Settings persist

**Next:** Move to 033-A

---

## TERMINAL 2: Session 031 - Offline-First Architecture 🔌

### 031-A: Connectivity Detection (2-3 hours)

**Status:** WAITING (after Phase 2)
**Goal:** Detect online/offline status

**Tasks:**

1. Create `src/main/utils/connectivity.ts`:

```typescript
import { net } from 'electron';

export class ConnectivityManager {
  private isOnline = true;
  private listeners: ((online: boolean) => void)[] = [];

  async checkConnectivity(): Promise<boolean> {
    try {
      const online = net.isOnline();
      if (online !== this.isOnline) {
        this.isOnline = online;
        this.notifyListeners();
      }
      return online;
    } catch {
      return false;
    }
  }

  onStatusChange(listener: (online: boolean) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach((l) => l(this.isOnline));
  }
}

export const connectivityManager = new ConnectivityManager();
```

2. Add periodic connectivity checks (every 30s)

**Success:** App knows when it's offline
**Next:** Move to 031-B

---

### 031-B: Smart Provider Selection (2-3 hours)

**Status:** WAITING (after 031-A)
**Goal:** Auto-select online vs offline providers

**Tasks:**

1. Create `src/main/providers/smart-provider.ts`:

```typescript
export class SmartProviderManager {
  async selectSTTProvider(): Promise<'deepgram' | 'vosk'> {
    const online = await connectivityManager.checkConnectivity();
    const hasApiKey = !!process.env.DEEPGRAM_API_KEY;

    if (online && hasApiKey) {
      return 'deepgram';
    }
    return 'vosk'; // Offline fallback
  }

  async selectTTSProvider(): Promise<'elevenlabs' | 'piper'> {
    const online = await connectivityManager.checkConnectivity();
    const hasApiKey = !!process.env.ELEVENLABS_API_KEY;

    if (online && hasApiKey) {
      return 'elevenlabs';
    }
    return 'piper'; // Offline fallback
  }

  async selectLLMProvider(): Promise<'fireworks' | 'local'> {
    const online = await connectivityManager.checkConnectivity();

    if (online) {
      return 'fireworks';
    }
    return 'local'; // Ollama or similar
  }
}
```

**Success:** Providers auto-selected based on connectivity
**Next:** Move to 031-C

---

### 031-C: API Response Caching (2-3 hours)

**Status:** WAITING (after 031-B)
**Goal:** Cache responses for offline use

**Tasks:**

1. Create simple response cache:

```typescript
export class ResponseCache {
  private cache = new Map<string, { response: string; timestamp: number }>();
  private readonly TTL = 24 * 60 * 60 * 1000; // 24 hours

  set(query: string, response: string): void {
    const key = this.hashQuery(query);
    this.cache.set(key, { response, timestamp: Date.now() });
  }

  get(query: string): string | null {
    const key = this.hashQuery(query);
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < this.TTL) {
      return entry.response;
    }
    return null;
  }

  private hashQuery(query: string): string {
    return query.toLowerCase().trim().slice(0, 100);
  }
}
```

2. Check cache before making API calls

**Success Criteria:**

- [ ] App detects offline mode
- [ ] Auto-switches to offline providers
- [ ] Common responses cached
- [ ] Graceful degradation works

**Next:** Move to Phase 4 → Session 035-A

---

## TERMINAL 3: Session 032 - Error Recovery & Resilience 🛡️

### 032-A: Circuit Breaker Pattern (2-3 hours)

**Status:** ✅ COMPLETED (Pre-existing)
**Goal:** Implement circuit breakers for external services

**Already Implemented in `src/main/utils/errors.ts`:**

- `CircuitBreaker` class with CLOSED, OPEN, HALF_OPEN states
- `execute()` method for automatic circuit breaking
- `canAttempt()`, `recordSuccess()`, `recordFailure()` for manual usage
- `getState()`, `getStats()`, `reset()` methods
- `onStateChange` callback for state transitions
- Already integrated with LLM, TTS, and STT managers

**Success:** Circuit breaker prevents cascading failures
**Next:** Move to 032-B

---

### 032-B: Retry with Backoff (2-3 hours)

**Status:** ✅ COMPLETED (Pre-existing)
**Goal:** Implement exponential backoff for retries

**Already Implemented in `src/main/utils/errors.ts`:**

- `withRetry()` function with full exponential backoff
- Configurable: `maxAttempts`, `initialDelayMs`, `maxDelayMs`, `backoffMultiplier`
- `retryCondition` callback to determine if retry should occur
- `onRetry` callback for retry notifications
- `createRetryable()` wrapper for creating retry-enabled functions
- `isRetryableError()` helper for network/API error detection

**Success:** Failed calls retry with exponential backoff
**Next:** Move to 032-C

---

### 032-C: User-Friendly Error Toasts (2-3 hours)

**Status:** ✅ COMPLETED
**Goal:** Show helpful error messages to users

**Completed Tasks:**

1. Created `src/renderer/components/ErrorToast.tsx`:
   - `ErrorNotification` interface with type, title, message, action
   - `ERROR_MESSAGES` mapping for user-friendly error translations
   - `getUserFriendlyMessage()` function for error code translation
   - `ToastItem` component with auto-dismiss (5s), animations, action buttons
   - `ErrorToastContainer` listening to `nova:error-notification` IPC

2. Created `src/renderer/components/ErrorToast.css`:
   - Fixed position top-right container
   - Type-based colors (error=red, warning=yellow, info=blue)
   - Enter/exit animations
   - Action buttons and dismiss button styling

3. Updated `src/main/preload.ts`:
   - Added `nova:error-notification` to valid `on` channels
   - Added `nova:retry-last` and `nova:set-offline-mode` to valid `invoke` channels

4. Updated `src/main/utils/errors.ts`:
   - Added `sendToRenderer()` method to `ErrorNotificationManager`
   - Notifications automatically sent to renderer via IPC

5. Added `<ErrorToastContainer />` to `src/renderer/App.tsx`

**Tasks:**

1. Create `src/renderer/components/ErrorToast.tsx`:

```tsx
interface ErrorToastProps {
  message: string;
  action?: { label: string; onClick: () => void };
  onDismiss: () => void;
}

export function ErrorToast({ message, action, onDismiss }: ErrorToastProps) {
  return (
    <div className="error-toast">
      <span className="error-icon">⚠️</span>
      <span className="error-message">{message}</span>
      {action && <button onClick={action.onClick}>{action.label}</button>}
      <button className="dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
```

2. Create error message mappings:

```typescript
const ERROR_MESSAGES: Record<string, string> = {
  DEEPGRAM_ERROR: 'Voice recognition unavailable. Using offline mode.',
  LLM_ERROR: 'AI service is slow. Response may be delayed.',
  TTS_ERROR: 'Voice output unavailable. Showing text response.',
  NETWORK_ERROR: 'No internet connection. Some features limited.',
};
```

3. Display toasts on errors with retry actions

**Success Criteria:**

- [ ] Circuit breakers on all external services
- [ ] Retries with exponential backoff
- [ ] User-friendly error messages
- [ ] Retry/fallback actions available

**Next:** Move to Phase 4 → Session 036-A

---

## TERMINAL 1: Session 033 - Cost Control & Rate Limiting 💰

### 033-A: API Cost Tracking (2-3 hours)

**Status:** WAITING (after 030-C)
**Goal:** Track API usage costs

**Tasks:**

1. Create `src/main/utils/cost-tracker.ts`:

```typescript
const API_COSTS = {
  deepgram: 0.0043, // per minute
  elevenlabs: 0.3, // per 1000 chars
  fireworks: 0.001, // per 1000 tokens
};

export class CostTracker {
  private dailySpend = 0;
  private dailyBudget = 5.0; // $5/day default
  private resetTime = this.getNextReset();

  recordUsage(service: keyof typeof API_COSTS, units: number): void {
    this.checkReset();
    this.dailySpend += API_COSTS[service] * units;
  }

  isWithinBudget(): boolean {
    this.checkReset();
    return this.dailySpend < this.dailyBudget;
  }

  getRemainingBudget(): number {
    return Math.max(0, this.dailyBudget - this.dailySpend);
  }

  private checkReset(): void {
    if (Date.now() > this.resetTime) {
      this.dailySpend = 0;
      this.resetTime = this.getNextReset();
    }
  }

  private getNextReset(): number {
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 0, 0);
    return tomorrow.getTime();
  }
}
```

**Success:** API costs tracked
**Next:** Move to 033-B

---

### 033-B: Budget Enforcement (2-3 hours)

**Status:** WAITING (after 033-A)
**Goal:** Enforce daily budget limits

**Tasks:**

1. Add budget check before API calls:

```typescript
async beforeApiCall(service: string): Promise<boolean> {
  if (!costTracker.isWithinBudget()) {
    // Switch to offline mode
    this.emit('budget-exceeded');
    return false;
  }
  return true;
}
```

2. Add budget settings to UI
3. Show budget status in footer

**Success:** Budget enforced, auto-fallback to offline
**Next:** Move to 033-C

---

### 033-C: Usage Dashboard (2-3 hours)

**Status:** WAITING (after 033-B)
**Goal:** Show usage stats to user

**Tasks:**

1. Create usage stats display in Settings:
   - Today's spend vs budget
   - Usage by service (STT, TTS, LLM)
   - Weekly/monthly trends
2. Add budget alerts when nearing limit

**Success Criteria:**

- [ ] API costs tracked per service
- [ ] Daily budget enforced
- [ ] Auto-fallback when budget exceeded
- [ ] Usage visible in UI

**Next:** Move to 033-D (Self-Improving Agent Foundation)

---

## TERMINAL 1: Session 033-D-F - Self-Improving Agent Foundation 🧠

**NEW ADDITION:** Fireworks AI GEPA-powered learning system

See detailed implementation in: `SELF_IMPROVING_AGENT_PLAN.md`

### 033-D: Basic Evaluation Protocol (2-3 hours)

**Status:** WAITING (after 033-C)
**Goal:** Create evaluation framework for tracking conversation quality

**Quick Overview:**

- Record every conversation with metrics (quality, confidence, correctness)
- Add user feedback buttons (👍👎⚠️)
- Track by domain (forex, chess, fitness, etc.)
- Persist evaluations for analysis

**Files to create:**

- `src/shared/types/evaluation.ts`
- `src/main/learning/eval-protocol.ts`
- `src/renderer/components/FeedbackButtons.tsx`

**Success:** Every conversation evaluated and feedback collected

---

### 033-E: Confidence Tracking (2-3 hours)

**Status:** WAITING (after 033-D)
**Goal:** Track Nova's confidence by domain and calibrate

**Quick Overview:**

- Calculate confidence per domain based on success rate
- Adjust personality prompts by confidence level
- "I'm not sure about this..." when confidence < 0.6
- Daily automatic recalibration

**Files to create:**

- `src/main/learning/confidence-tracker.ts`
- `src/main/learning/continuous-improver.ts`

**Success:** Nova expresses appropriate uncertainty per domain

---

### 033-F: Failure Pattern Analysis (2-3 hours)

**Status:** WAITING (after 033-E)
**Goal:** Identify patterns in failures for improvement

**Quick Overview:**

- Analyze failed conversations
- Identify patterns: hallucinations, over-confidence, personality issues
- Suggest fixes for each pattern
- Display insights in Settings UI

**Files to create:**

- `src/main/learning/failure-analyzer.ts`

**Success:** Failure patterns identified with suggested fixes

**Next:** Move to Phase 4 → Session 034-A

---

# ═══════════════════════════════════════════════════════════════

# PHASE 3.5 COMPLETE → BASIC LEARNING FOUNDATION READY! 🎓

# Continue to Phase 4, then return for GEPA integration in Phase 6.5

# ═══════════════════════════════════════════════════════════════

---

# ═══════════════════════════════════════════════════════════════

# PHASE 4: ADVANCED VOICE & MEMORY

# ═══════════════════════════════════════════════════════════════

## TERMINAL 1: Session 034 - Enhanced Memory System 🧠

### 034-A: Semantic Chunking (2-3 hours)

**Status:** WAITING (after Phase 3)
**Goal:** Break conversations into semantic chunks

**Tasks:**

1. Create `src/main/memory/semantic-chunker.ts`:

```typescript
export interface SemanticChunk {
  id: string;
  content: string;
  topics: string[];
  importance: number; // 0-1
  timestamp: number;
  embedding?: number[]; // For future vector search
}

export class SemanticChunker {
  chunkConversation(turns: ConversationTurn[]): SemanticChunk[] {
    const chunks: SemanticChunk[] = [];
    let currentChunk: string[] = [];
    let currentTopics: Set<string> = new Set();

    for (const turn of turns) {
      currentChunk.push(`User: ${turn.userMessage}`);
      currentChunk.push(`Nova: ${turn.novaResponse}`);
      turn.topics.forEach((t) => currentTopics.add(t));

      // Start new chunk on topic change or size limit
      if (currentChunk.length >= 10 || this.detectTopicShift(turns)) {
        chunks.push(this.createChunk(currentChunk, currentTopics));
        currentChunk = [];
        currentTopics = new Set();
      }
    }

    return chunks;
  }

  private createChunk(content: string[], topics: Set<string>): SemanticChunk {
    return {
      id: crypto.randomUUID(),
      content: content.join('\n'),
      topics: Array.from(topics),
      importance: this.calculateImportance(content),
      timestamp: Date.now(),
    };
  }

  private calculateImportance(content: string[]): number {
    // Higher importance for: questions, decisions, preferences
    const text = content.join(' ').toLowerCase();
    let score = 0.5;
    if (text.includes('remember')) score += 0.2;
    if (text.includes('prefer')) score += 0.2;
    if (text.includes('important')) score += 0.2;
    return Math.min(1, score);
  }
}
```

**Success:** Conversations chunked semantically
**Next:** Move to 034-B

---

### 034-B: Importance Scoring (2-3 hours)

**Status:** WAITING (after 034-A)
**Goal:** Score memories by importance for retention

**Tasks:**

1. Create importance scoring system:
   - User preferences: HIGH
   - Facts about user: HIGH
   - Casual chat: LOW
   - Decisions/agreements: HIGH

2. Implement memory consolidation (short → long term)

**Success:** Important memories prioritized
**Next:** Move to 034-C

---

### 034-C: User Preference Learning (2-3 hours)

**Status:** WAITING (after 034-B)
**Goal:** Learn and remember user preferences

**Tasks:**

1. Create preference extraction:

```typescript
export class PreferenceLearner {
  extractPreferences(text: string): Preference[] {
    const preferences: Preference[] = [];

    // "I like X", "I prefer X", "I always X"
    const patterns = [
      /i (?:like|love|prefer|enjoy) (\w+(?:\s+\w+)?)/gi,
      /i (?:don't like|hate|dislike) (\w+(?:\s+\w+)?)/gi,
      /i always (\w+)/gi,
      /my favorite (\w+) is (\w+)/gi,
    ];

    // Extract and store preferences
    return preferences;
  }
}
```

2. Include preferences in LLM context

**Success Criteria:**

- [ ] Conversations chunked semantically
- [ ] Important memories scored higher
- [ ] User preferences extracted and remembered
- [ ] Context intelligently assembled

**Next:** Move to 037-A

---

## TERMINAL 2: Session 035 - Context-Aware Wake Word 🎤

### 035-A: Wake Word During Speech (2-3 hours)

**Status:** WAITING (after Phase 3)
**Goal:** Ignore wake word when Nova is speaking

**Tasks:**

1. Add state tracking to wake word detector:

```typescript
export class WakeWordDetector {
  private novaIsSpeaking = false;

  setNovaSpeaking(speaking: boolean): void {
    this.novaIsSpeaking = speaking;
  }

  async process(audioBuffer: Buffer): Promise<WakeWordResult | null> {
    // Ignore wake word while Nova is speaking
    if (this.novaIsSpeaking) return null;

    return this.porcupine.process(audioBuffer);
  }
}
```

2. Connect to TTS events

**Success:** Wake word ignored during speech
**Next:** Move to 035-B

---

### 035-B: Multiple Wake Phrases (2-3 hours)

**Status:** WAITING (after 035-A)
**Goal:** Support "Nova", "Hey Nova", etc.

**Tasks:**

1. Add alternative wake phrase detection
2. Make wake phrases configurable in settings

**Success:** Multiple wake phrases work
**Next:** Move to 035-C

---

### 035-C: Barge-In Capability (2-3 hours)

**Status:** WAITING (after 035-B)
**Goal:** Allow user to interrupt Nova mid-response

**Tasks:**

1. Detect speech during TTS playback
2. Cancel TTS and switch to listening
3. Add barge-in toggle in settings

**Success Criteria:**

- [ ] Wake word ignored during Nova speech
- [ ] Multiple wake phrases supported
- [ ] Barge-in interrupts Nova
- [ ] All configurable in settings

**Next:** Move to Phase 5 → Session 039-A

---

## TERMINAL 3: Session 036 - Audio Pipeline Enhancements 🔊

### 036-A: Noise Reduction (2-3 hours)

**Status:** WAITING (after Phase 3)
**Goal:** Add audio preprocessing

**Tasks:**

1. Create audio preprocessor:

```typescript
export class AudioPreprocessor {
  private readonly noiseGate = -40; // dB

  process(audioBuffer: Float32Array): Float32Array {
    // Apply noise gate
    return audioBuffer.map((sample) => {
      const db = 20 * Math.log10(Math.abs(sample) || 0.0001);
      return db > this.noiseGate ? sample : sample * 0.1;
    });
  }
}
```

**Success:** Background noise reduced
**Next:** Move to 036-B

---

### 036-B: Multiple Audio Sources (2-3 hours)

**Status:** WAITING (after 036-A)
**Goal:** Support multiple microphone inputs

**Tasks:**

1. Add audio device selector in settings
2. Support hot-switching between devices
3. Add device detection for new devices

**Success:** Multiple input devices supported
**Next:** Move to 036-C

---

### 036-C: Echo Cancellation (2-3 hours)

**Status:** WAITING (after 036-B)
**Goal:** Prevent Nova from hearing itself

**Tasks:**

1. Implement basic echo cancellation
2. Use reference signal from TTS output
3. Apply to incoming audio

**Success Criteria:**

- [ ] Noise reduction works
- [ ] Multiple audio sources supported
- [ ] Echo cancellation prevents feedback
- [ ] Device hot-switching works

**Next:** Move to Phase 5 → Session 040-A

---

## TERMINAL 1: Session 037 - Conversation Context Builder 📝

### 037-A: Multi-Turn Tracking (2-3 hours)

**Status:** WAITING (after 034-C)
**Goal:** Track conversation across many turns

**Tasks:**

1. Create context builder that assembles relevant context
2. Implement sliding window with summarization
3. Add topic tracking

**Success:** Multi-turn context assembled
**Next:** Move to 037-B

---

### 037-B: Sentiment Analysis (2-3 hours)

**Status:** WAITING (after 037-A)
**Goal:** Detect user sentiment

**Tasks:**

1. Create simple sentiment analyzer:

```typescript
export class SentimentAnalyzer {
  analyze(text: string): 'positive' | 'negative' | 'neutral' {
    const positive = ['great', 'awesome', 'thanks', 'love', 'good'];
    const negative = ['bad', 'hate', 'annoying', 'wrong', 'no'];

    const lower = text.toLowerCase();
    const posCount = positive.filter((w) => lower.includes(w)).length;
    const negCount = negative.filter((w) => lower.includes(w)).length;

    if (posCount > negCount) return 'positive';
    if (negCount > posCount) return 'negative';
    return 'neutral';
  }
}
```

2. Adjust Nova's tone based on sentiment

**Success:** Sentiment detected and used
**Next:** Move to 037-C

---

### 037-C: Topic Detection (2-3 hours)

**Status:** WAITING (after 037-B)
**Goal:** Detect topic shifts in conversation

**Tasks:**

1. Track topics across turns
2. Detect when topic changes
3. Use for context selection

**Success Criteria:**

- [ ] Multi-turn context works
- [ ] Sentiment detected
- [ ] Topic shifts detected
- [ ] Context intelligently assembled

**Next:** Move to Phase 5 → Session 038-A

---

# ═══════════════════════════════════════════════════════════════

# PHASE 5: UX & ONBOARDING

# ═══════════════════════════════════════════════════════════════

## TERMINAL 1: Session 038 - Onboarding Wizard 🎓

### 038-A: Welcome Screen (2-3 hours)

**Goal:** Create first-time user welcome

**Tasks:**

1. Detect first launch
2. Create welcome modal
3. Add "Get Started" button

---

### 038-B: API Key Setup (2-3 hours)

**Goal:** Guide user through API key configuration

**Tasks:**

1. Create API key input forms
2. Add validation (test keys)
3. Link to provider signup pages

---

### 038-C: Mic Test & Tutorial (2-3 hours)

**Goal:** Test microphone and show quick tutorial

**Tasks:**

1. Add microphone test with visual feedback
2. Create quick feature tour
3. Save onboarding completion status

---

## TERMINAL 2: Session 039 - Accessibility Features ♿

### 039-A: Keyboard Navigation (2-3 hours)

**Goal:** Full keyboard navigation support

---

### 039-B: Screen Reader Support (2-3 hours)

**Goal:** ARIA labels and screen reader compatibility

---

### 039-C: Visual Accessibility (2-3 hours)

**Goal:** High contrast mode, reduced motion, font sizes

---

## TERMINAL 3: Session 040 - Enhanced Settings UI ⚙️

### 040-A: Visualization Settings (2-3 hours)

**Goal:** Attractor mode, particle count, color themes

---

### 040-B: Audio Settings (2-3 hours)

**Goal:** Device selection, volume, sensitivity

---

### 040-C: Behavior Settings (2-3 hours)

**Goal:** Wake word, auto-start, privacy options

---

## TERMINAL 1: Session 041 - Loading States & Feedback 📊

### 041-A: Loading Indicators (2-3 hours)

**Goal:** Add loading states for all async operations

---

### 041-B: Progress Feedback (2-3 hours)

**Goal:** Show progress for long operations

---

### 041-C: Shortcut Help (2-3 hours)

**Goal:** Keyboard shortcut cheat sheet, help modal

---

# ═══════════════════════════════════════════════════════════════

# PHASE 6: INTELLIGENCE & SKILLS

# ═══════════════════════════════════════════════════════════════

## TERMINAL 1: Session 042 - Knowledge Base System 📚

### 042-A: Knowledge Store (2-3 hours)

**Goal:** Create local knowledge storage

---

### 042-B: Fact Extraction (2-3 hours)

**Goal:** Extract facts from conversations

---

### 042-C: Knowledge Retrieval (2-3 hours)

**Goal:** Include relevant knowledge in context

---

## TERMINAL 2: Session 043 - Skill System Architecture 🔧

### 043-A: Skill Interface (2-3 hours)

**Goal:** Define plugin-style skill interface

---

### 043-B: Built-in Skills (2-3 hours)

**Goal:** Calculator, Timer, Weather skills

---

### 043-C: Skill Selection (2-3 hours)

**Goal:** Auto-select skills based on query

---

## TERMINAL 3: Session 044 - Agent Tool Sandboxing 🔒

### 044-A: Sandboxed Execution (2-3 hours)

**Goal:** Run tools in restricted environment

---

### 044-B: Permission System (2-3 hours)

**Goal:** User approval for dangerous operations

---

### 044-C: Audit & Rollback (2-3 hours)

**Goal:** Audit trail and rollback capability

---

## TERMINAL 1: Session 045 - Proactive Intelligence 🤖

### 045-A: Background Research (2-3 hours)

**Goal:** Research mode while idle

---

### 045-B: Smart Notifications (2-3 hours)

**Goal:** Proactive suggestions

---

### 045-C: Task Scheduling (2-3 hours)

**Goal:** Reminders and scheduled tasks

---

# ═══════════════════════════════════════════════════════════════

# PHASE 6.5: GEPA LEARNING ENGINE (Self-Improving Agent) 🤖

# ═══════════════════════════════════════════════════════════════

**NEW ADDITION:** Full Fireworks AI GEPA integration for automatic prompt optimization

See detailed implementation in: `SELF_IMPROVING_AGENT_PLAN.md`

## TERMINAL 1: Session 045-D-G - GEPA Integration & Learning Loop

### 045-D: Fireworks GEPA Integration (3-4 hours)

**Status:** WAITING (after Phase 6 complete)
**Goal:** Integrate Fireworks GEPA for automatic prompt optimization

**Quick Overview:**

- Install Fireworks SDK
- Analyze failures and propose prompt improvements
- Validate improvements on test set
- Apply if validation score >60%

**Files to create:**

- `src/main/learning/gepa-optimizer.ts`

**Key Features:**

- Automatic prompt optimization based on failures
- Validation before applying changes
- Expected 30-50% improvement in response quality

---

### 045-E: Continuous Learning Loop (3-4 hours)

**Status:** WAITING (after 045-D)
**Goal:** Automated daily improvement cycle

**Quick Overview:**

- Daily confidence calibration (3 AM)
- Weekly improvement cycle (Sunday 4 AM)
- Manual trigger available
- Automatic rollback if improvements fail

**Enhanced Files:**

- `src/main/learning/continuous-improver.ts`

**Automation:**

- Daily: Recalibrate confidence
- Weekly: Analyze failures → Propose improvements → Validate → Apply

---

### 045-F: Learning Dashboard UI (2-3 hours)

**Status:** WAITING (after 045-E)
**Goal:** Visualize learning progress in Settings

**Quick Overview:**

- Overall performance metrics
- Confidence visualization by domain
- Improvement history
- Manual improvement trigger
- Next learning cycle countdown

**Files to create:**

- `src/renderer/components/LearningDashboard.tsx`
- `src/renderer/components/LearningDashboard.css`

**Displays:**

- Success rate over time
- Confidence scores by domain (color-coded bars)
- Recent improvements applied
- Scheduled learning times

---

### 045-G: Testing & Documentation (2-3 hours)

**Status:** WAITING (after 045-F)
**Goal:** Test learning system and document usage

**Quick Overview:**

- Comprehensive tests for evaluation, confidence, GEPA
- User documentation for learning features
- Troubleshooting guide
- Best practices

**Files to create:**

- `tests/learning.test.ts`
- `docs/SELF_IMPROVING_AGENT.md`

**Success Criteria:**

- [ ] All learning tests pass
- [ ] GEPA successfully proposes improvements
- [ ] Validation prevents bad improvements
- [ ] Daily/weekly cycles work automatically
- [ ] Dashboard displays correctly
- [ ] Documentation complete

**Next:** Move to Phase 7 → Session 046-A

---

# ═══════════════════════════════════════════════════════════════

# PHASE 6.5 COMPLETE → NOVA NOW SELF-IMPROVES! 🚀

# Expected Impact: 30-50% better responses, natural uncertainty expression

# ═══════════════════════════════════════════════════════════════

---

# ═══════════════════════════════════════════════════════════════

# PHASE 7: PLATFORM & SECURITY

# ═══════════════════════════════════════════════════════════════

## TERMINAL 1: Session 046 - Enhanced Security 🔐

### 046-A: Secure Storage (2-3 hours)

**Goal:** Use system keychain for credentials

---

### 046-B: Encryption (2-3 hours)

**Goal:** Encrypt conversation logs at rest

---

### 046-C: Privacy Mode (2-3 hours)

**Goal:** No-logging mode, data export/deletion

---

## TERMINAL 2: Session 047 - Platform Integration 💻

### 047-A: System Tray (2-3 hours)

**Goal:** Enhanced tray menu

---

### 047-B: Global Hotkeys (2-3 hours)

**Goal:** Customizable global shortcuts

---

### 047-C: Auto-Update (2-3 hours)

**Goal:** Automatic update system

---

## TERMINAL 3: Session 048 - Developer Experience 👨‍💻

### 048-A: HMR for Main (2-3 hours)

**Goal:** Hot reload for main process

---

### 048-B: Debug Tools (2-3 hours)

**Goal:** Better debugging dashboard

---

### 048-C: Performance Profiling (2-3 hours)

**Goal:** Built-in profiling tools

---

## TERMINAL 1: Session 049 - Observability 📈

### 049-A: Metrics Dashboard (2-3 hours)

**Goal:** Performance metrics display

---

### 049-B: API Usage Tracking (2-3 hours)

**Goal:** Track API calls and latency

---

### 049-C: Health Checks (2-3 hours)

**Goal:** Service health monitoring

---

# ═══════════════════════════════════════════════════════════════

# PHASE 8: TESTING & RELEASE

# ═══════════════════════════════════════════════════════════════

## TERMINAL 1: Session 050 - E2E Testing Suite ✅

### 050-A: Test Infrastructure (2-3 hours)

**Goal:** Set up Playwright/Spectron

---

### 050-B: Voice Flow Tests (2-3 hours)

**Goal:** Test complete voice interactions

---

### 050-C: Visual Tests (2-3 hours)

**Goal:** Visual regression testing

---

### 050-D: Performance Tests (2-3 hours)

**Goal:** Benchmark and stress tests

---

## TERMINAL 2: Session 051 - Documentation 📖

### 051-A: User Guide (2-3 hours)

**Goal:** Complete user documentation

---

### 051-B: Developer Guide (2-3 hours)

**Goal:** Developer onboarding docs

---

### 051-C: API Reference (2-3 hours)

**Goal:** Complete API documentation

---

## TERMINAL 3: Session 052 - Release Preparation 🚀

### 052-A: CI/CD Pipeline (2-3 hours)

**Goal:** Automated build and release

---

### 052-B: Platform Builds (2-3 hours)

**Goal:** Windows, Mac, Linux installers

---

### 052-C: Marketing Materials (2-3 hours)

**Goal:** Screenshots, demo video, changelog

---

# ═══════════════════════════════════════════════════════════════

# SESSION 053: FINAL QA & LAUNCH (All Terminals)

# ═══════════════════════════════════════════════════════════════

### 053-A: Cross-Platform QA (2-3 hours)

**Goal:** Test on all platforms

### 053-B: Demo Video (2-3 hours)

**Goal:** Record demo video

### 053-C: Launch Checklist (2-3 hours)

**Goal:** Final checks and launch

---

# ═══════════════════════════════════════════════════════════════

# INSTRUCTIONS FOR TERMINALS

# ═══════════════════════════════════════════════════════════════

## How to Work

1. **Check your queue** at the top of this file
2. **Start with your first session** (e.g., Terminal 1 starts with 027-A)
3. **When you complete a chunk**, immediately move to the next in your queue
4. **Update the ACTIVE SESSIONS table** as you progress
5. **Lock files** you're modifying
6. **Test after each chunk** before moving on

## When Starting a Chunk

```markdown
1. Update ACTIVE SESSIONS table:
   | 1 | 027-A | ACTIVE | Real Audio (Part A) | tts/manager.ts | 2026-01-14 |

2. Read the chunk instructions carefully

3. Implement the tasks

4. Test your changes

5. Commit with message: "session-027-A: TTS audio streaming"

6. Update table to show next chunk:
   | 1 | 027-B | ACTIVE | Real Audio (Part B) | App.tsx | 2026-01-14 |
```

## When Completing a Phase

After finishing your last chunk in a phase, check if other terminals are done.
If all terminals finished the phase, coordinate to start the next phase together.

---

**Last Updated:** 2026-01-14
**Total Sessions:** 51 (027-077 broken into ~75 chunks)
**Estimated Total Hours:** 150-200

```

```
