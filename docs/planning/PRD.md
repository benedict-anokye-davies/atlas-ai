# Nova Desktop - Voice-First AI Assistant
## Product Requirements Document (PRD)

**Version**: 1.0  
**Status**: Phase 1 - Voice Pipeline  
**Target**: Full MVP in 4 phases

---

## Project Overview

Nova is a voice-first desktop AI assistant with:
- Wake word activation ("Hey Nova")
- Real-time speech-to-text (Deepgram)
- LLM processing (Fireworks AI - DeepSeek R1)
- Natural text-to-speech (ElevenLabs)
- Visual orb interface (React Three Fiber)
- Persistent memory (Mem0 + LanceDB)
- Agent tools (files, browser, terminal, git)

---

## Tech Stack

- **Runtime**: Electron 28+
- **Frontend**: React 18 + TypeScript 5
- **3D Graphics**: React Three Fiber + Three.js
- **State**: Zustand
- **Logging**: Winston
- **Testing**: Vitest + Playwright
- **Build**: Vite + electron-builder

---

## Phase 1: Voice Pipeline (Current)

### Task 1: Project Setup
**Priority**: Critical  
**Estimate**: 30-45 min  
**Status**: [ ] Not Started

#### Sub-tasks:
- [ ] 1.1 Initialize Electron + React + TypeScript with Vite
- [ ] 1.2 Configure electron-builder for packaging
- [ ] 1.3 Set up project folder structure
- [ ] 1.4 Configure TypeScript (strict mode)
- [ ] 1.5 Add ESLint + Prettier configuration
- [ ] 1.6 Create basic main process (src/main/index.ts)
- [ ] 1.7 Create basic renderer (src/renderer/App.tsx)
- [ ] 1.8 Verify hot reload works

**Acceptance Criteria**:
- `npm run dev` starts Electron app with React
- Hot reload works for renderer changes
- TypeScript compiles without errors

---

### Task 2: Environment & Configuration
**Priority**: Critical  
**Estimate**: 15-20 min  
**Status**: [ ] Not Started

#### Sub-tasks:
- [ ] 2.1 Create .env.example template
- [ ] 2.2 Set up dotenv loading in main process
- [ ] 2.3 Create config validation (all keys present)
- [ ] 2.4 Add config types (src/main/config/types.ts)
- [ ] 2.5 Create getConfig() utility with defaults

**Acceptance Criteria**:
- App fails gracefully if API keys missing
- Config accessible from main process
- .env.example documents all required keys

---

### Task 3: Logging System
**Priority**: High  
**Estimate**: 20-30 min  
**Status**: [ ] Not Started

#### Sub-tasks:
- [ ] 3.1 Install and configure Winston
- [ ] 3.2 Create logger factory (src/main/utils/logger.ts)
- [ ] 3.3 Set up log rotation (daily files)
- [ ] 3.4 Add log levels (debug, info, warn, error)
- [ ] 3.5 Create IPC logger for renderer
- [ ] 3.6 Add performance timing utilities

**Acceptance Criteria**:
- Logs written to ~/.nova/logs/
- Console output in development
- File output in production
- Performance metrics logged

---

### Task 4: Error Handling & Recovery
**Priority**: High  
**Estimate**: 25-35 min  
**Status**: [ ] Not Started

#### Sub-tasks:
- [ ] 4.1 Create global error handler (main process)
- [ ] 4.2 Create error boundary (renderer)
- [ ] 4.3 Add retry utilities with exponential backoff
- [ ] 4.4 Create circuit breaker for API calls
- [ ] 4.5 Add crash recovery (save state before exit)
- [ ] 4.6 Create error notification system

**Acceptance Criteria**:
- Uncaught exceptions logged and handled
- API failures retry 3x with backoff
- App can recover from crashes

---

### Task 5: Wake Word Detection (Porcupine)
**Priority**: Critical  
**Estimate**: 45-60 min  
**Status**: [ ] Not Started

#### Sub-tasks:
- [ ] 5.1 Install @picovoice/porcupine-node
- [ ] 5.2 Create WakeWordDetector class
- [ ] 5.3 Train custom "Hey Nova" wake word (or use built-in)
- [ ] 5.4 Set up audio input stream (node-record-lpcm16)
- [ ] 5.5 Handle microphone permissions
- [ ] 5.6 Add sensitivity configuration
- [ ] 5.7 Create wake word event emitter
- [ ] 5.8 Add cooldown to prevent rapid triggers

**Acceptance Criteria**:
- "Hey Nova" triggers wake event
- Works with default system microphone
- <200ms detection latency
- No false positives during music/TV

---

### Task 6: Voice Activity Detection (Silero VAD)
**Priority**: High  
**Estimate**: 30-40 min  
**Status**: [ ] Not Started

#### Sub-tasks:
- [ ] 6.1 Install @ricky0123/vad-node
- [ ] 6.2 Create VADManager class
- [ ] 6.3 Configure speech start/end thresholds
- [ ] 6.4 Add speech buffer accumulation
- [ ] 6.5 Integrate with wake word (start VAD after wake)
- [ ] 6.6 Add timeout for long pauses
- [ ] 6.7 Create speech segment events

**Acceptance Criteria**:
- Detects when user starts/stops speaking
- Accumulates speech into segments
- Handles pauses naturally (1.5s threshold)
- Works alongside wake word detection

---

### Task 7: Audio Pipeline Manager
**Priority**: Critical  
**Estimate**: 40-50 min  
**Status**: [ ] Not Started

#### Sub-tasks:
- [ ] 7.1 Create AudioPipeline orchestrator class
- [ ] 7.2 Implement state machine (idle -> listening -> processing -> speaking)
- [ ] 7.3 Coordinate wake word + VAD + STT + TTS
- [ ] 7.4 Handle audio input/output device selection
- [ ] 7.5 Add pipeline pause/resume controls
- [ ] 7.6 Create audio level monitoring
- [ ] 7.7 Add barge-in detection (interrupt TTS)

**Acceptance Criteria**:
- Smooth transitions between pipeline states
- Can interrupt Nova while speaking
- Proper cleanup on state changes
- Audio levels visible in UI

---

### Task 8: Speech-to-Text (Deepgram)
**Priority**: Critical  
**Estimate**: 35-45 min  
**Status**: [ ] Not Started

#### Sub-tasks:
- [ ] 8.1 Install @deepgram/sdk
- [ ] 8.2 Create DeepgramSTT class
- [ ] 8.3 Configure Nova-3 model (best accuracy)
- [ ] 8.4 Implement streaming transcription
- [ ] 8.5 Add interim results handling
- [ ] 8.6 Handle punctuation and formatting
- [ ] 8.7 Add language detection (optional)
- [ ] 8.8 Create transcription events

**Acceptance Criteria**:
- Real-time transcription with <300ms latency
- Interim results for UI feedback
- Proper punctuation in final text
- Handles various accents

---

### Task 9: Offline STT Fallback (Vosk)
**Priority**: Medium  
**Estimate**: 30-40 min  
**Status**: [ ] Not Started

#### Sub-tasks:
- [ ] 9.1 Install vosk (or whisper.cpp alternative)
- [ ] 9.2 Download small English model
- [ ] 9.3 Create VoskSTT class (same interface as Deepgram)
- [ ] 9.4 Add automatic fallback on Deepgram failure
- [ ] 9.5 Cache model loading for fast startup
- [ ] 9.6 Add offline mode toggle

**Acceptance Criteria**:
- Works without internet connection
- <1s latency for short phrases
- Graceful switch from Deepgram on failure
- Model bundled with app or downloaded on first run

---

### Task 10: LLM Integration (Fireworks AI)
**Priority**: Critical  
**Estimate**: 40-50 min  
**Status**: [ ] Not Started

#### Sub-tasks:
- [ ] 10.1 Install openai SDK (Fireworks uses OpenAI-compatible API)
- [ ] 10.2 Create FireworksLLM class
- [ ] 10.3 Configure DeepSeek R1 32B model
- [ ] 10.4 Implement streaming responses
- [ ] 10.5 Add system prompt for Nova personality
- [ ] 10.6 Create conversation history management
- [ ] 10.7 Add token counting and limits
- [ ] 10.8 Implement response caching (optional)

**System Prompt**:
```
You are Nova, a helpful and friendly AI assistant. You are:
- Concise but thorough
- Proactive in offering help
- Honest about limitations
- Warm but professional

Current time: {timestamp}
User name: {user_name}
```

**Acceptance Criteria**:
- Streaming responses for natural feel
- <2s time to first token
- Proper conversation context
- Handles long conversations gracefully

---

### Task 11: LLM Fallback (OpenRouter)
**Priority**: Medium  
**Estimate**: 20-30 min  
**Status**: [ ] Not Started

#### Sub-tasks:
- [ ] 11.1 Create OpenRouterLLM class (same interface)
- [ ] 11.2 Configure fallback model (Claude or GPT-4)
- [ ] 11.3 Add automatic fallback on Fireworks failure
- [ ] 11.4 Implement model selection logic
- [ ] 11.5 Add cost tracking per request

**Acceptance Criteria**:
- Seamless fallback to OpenRouter
- Same conversation context maintained
- User notified of fallback (optional)

---

### Task 12: Text-to-Speech (ElevenLabs)
**Priority**: Critical  
**Estimate**: 35-45 min  
**Status**: [ ] Not Started

#### Sub-tasks:
- [ ] 12.1 Install elevenlabs SDK
- [ ] 12.2 Create ElevenLabsTTS class
- [ ] 12.3 Select and configure voice (Onyx or custom)
- [ ] 12.4 Implement streaming audio playback
- [ ] 12.5 Add SSML support for expression
- [ ] 12.6 Create audio queue for sentences
- [ ] 12.7 Handle interruption (stop on new input)
- [ ] 12.8 Add voice speed/stability controls

**Acceptance Criteria**:
- Natural sounding speech
- <500ms time to first audio
- Can be interrupted mid-sentence
- Consistent voice character

---

### Task 13: Offline TTS Fallback
**Priority**: Medium  
**Estimate**: 25-35 min  
**Status**: [ ] Not Started

#### Sub-tasks:
- [ ] 13.1 Install say.js or pyttsx3 equivalent
- [ ] 13.2 Create LocalTTS class (same interface)
- [ ] 13.3 Configure best available system voice
- [ ] 13.4 Add automatic fallback on ElevenLabs failure
- [ ] 13.5 Add offline mode toggle

**Acceptance Criteria**:
- Works without internet
- Reasonable quality for status messages
- Fast fallback (<100ms switch)

---

### Task 14: Test Suite
**Priority**: High  
**Estimate**: 45-60 min  
**Status**: [ ] Not Started

#### Sub-tasks:
- [ ] 14.1 Set up Vitest configuration
- [ ] 14.2 Create test utilities and mocks
- [ ] 14.3 Write unit tests for each module
- [ ] 14.4 Add integration tests for pipeline
- [ ] 14.5 Create E2E tests with Playwright
- [ ] 14.6 Set up code coverage reporting
- [ ] 14.7 Add CI/CD test script

**Coverage Targets**:
- Unit tests: 80%+ coverage
- Integration: All critical paths
- E2E: Happy path + error cases

**Acceptance Criteria**:
- `npm run test` passes
- 80%+ code coverage
- All critical paths tested

---

### Task 15: Performance Optimization
**Priority**: High  
**Estimate**: 30-40 min  
**Status**: [ ] Not Started

#### Sub-tasks:
- [ ] 15.1 Profile startup time (target <3s)
- [ ] 15.2 Optimize audio buffer sizes
- [ ] 15.3 Add lazy loading for heavy modules
- [ ] 15.4 Implement memory usage monitoring
- [ ] 15.5 Optimize IPC communication
- [ ] 15.6 Add performance metrics dashboard

**Performance Targets**:
- Startup: <3s cold, <1s warm
- Wake word: <200ms detection
- STT: <300ms latency
- LLM: <2s first token
- TTS: <500ms first audio
- Total response: <3s typical

**Acceptance Criteria**:
- All performance targets met
- Memory stable (<500MB)
- No UI jank during processing

---

### Task 16: Documentation
**Priority**: Medium  
**Estimate**: 30-40 min  
**Status**: [ ] Not Started

#### Sub-tasks:
- [ ] 16.1 Create README.md with setup instructions
- [ ] 16.2 Document API key acquisition
- [ ] 16.3 Add architecture diagram
- [ ] 16.4 Create troubleshooting guide
- [ ] 16.5 Add contributing guidelines
- [ ] 16.6 Document all configuration options

**Acceptance Criteria**:
- New developer can set up in <30 min
- All features documented
- Common issues addressed

---

## Phase 2: Visual Orb (Next)

### Planned Tasks:
- [ ] React Three Fiber setup
- [ ] Aizawa strange attractor implementation
- [ ] 50K particle system
- [ ] State-based color transitions
- [ ] Mouse interaction and physics
- [ ] Notification badges
- [ ] Performance optimization (60fps)

---

## Phase 3: Agent & Tools (Future)

### Planned Tasks:
- [ ] File system access (read/write/search)
- [ ] Browser automation (Playwright)
- [ ] Terminal command execution
- [ ] Git operations
- [ ] Web search integration
- [ ] Screenshot capture
- [ ] Clipboard access

---

## Phase 4: Memory System (Future)

### Planned Tasks:
- [ ] Mem0 integration
- [ ] LanceDB vector storage
- [ ] HyDE query expansion
- [ ] Temporal weighting
- [ ] Memory consolidation
- [ ] Context injection

---

## Progress Tracking

**Phase 1 Progress**: 0/16 tasks complete  
**Current Task**: None started  
**Last Updated**: Not started  
**Blockers**: None

---

## Notes for AI Agents

When implementing tasks:
1. Read this PRD and progress.txt first
2. Find the next incomplete task ([ ] Not Started)
3. Implement ALL sub-tasks for that task
4. Write tests for the implementation
5. Update task status to [x] Complete
6. Update progress.txt with summary
7. Make a git commit: `feat(phase1): task N - description`
8. Move to next task

**Quality Gates**:
- TypeScript must compile without errors
- ESLint must pass
- Tests must pass
- No console errors in runtime

**If stuck**: Add blocker notes and move to next task
