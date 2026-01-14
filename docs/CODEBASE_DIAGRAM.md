# Nova Desktop - Codebase Architecture Diagram

> **Version:** 0.1.2  
> **Last Updated:** January 13, 2026  
> **Type:** Electron + React + TypeScript Voice-First AI Desktop Assistant

---

## High-Level System Architecture

```
+==============================================================================+
|                              NOVA DESKTOP                                     |
|                    Voice-First AI Desktop Assistant                           |
+==============================================================================+
|                                                                               |
|  +-------------------------------------------------------------------------+ |
|  |                        RENDERER PROCESS (React)                         | |
|  |                                                                         | |
|  |   +-------------------+    +------------------+    +----------------+   | |
|  |   |    App.tsx        |    |   NovaOrb.tsx    |    | NovaParticles  |   | |
|  |   |  (Main UI Entry)  |<-->| (3D Canvas Wrap) |<-->| (Attractor Viz)|   | |
|  |   +-------------------+    +------------------+    +----------------+   | |
|  |            |                       |                      |             | |
|  |            v                       v                      v             | |
|  |   +-------------------+    +------------------+    +----------------+   | |
|  |   | useNovaState.ts   |    |  attractors.ts   |    |   shaders.ts   |   | |
|  |   | (IPC State Hook)  |    | (Aizawa Math)    |    | (GLSL Shaders) |   | |
|  |   +-------------------+    +------------------+    +----------------+   | |
|  |            |                                                            | |
|  +------------|------------------------------------------------------------+ |
|               | IPC (contextBridge)                                          |
|               v                                                              |
|  +-------------------------------------------------------------------------+ |
|  |                         PRELOAD SCRIPT                                  | |
|  |                        (preload.ts)                                     | |
|  |   window.nova = { start, stop, triggerWake, sendText, ... }            | |
|  +-------------------------------------------------------------------------+ |
|               |                                                              |
|               v                                                              |
|  +-------------------------------------------------------------------------+ |
|  |                         MAIN PROCESS (Electron)                         | |
|  |                                                                         | |
|  |  +---------------------------+  +------------------------------------+  | |
|  |  |      IPC Handlers         |  |           System Tray              |  | |
|  |  |      (handlers.ts)        |  |         (tray/index.ts)            |  | |
|  |  |  nova:start, nova:stop,   |  |  Push-to-talk, Show/Hide Window   |  | |
|  |  |  nova:trigger-wake, ...   |  |                                    |  | |
|  |  +---------------------------+  +------------------------------------+  | |
|  |               |                              |                          | |
|  |               +----------+-------------------+                          | |
|  |                          |                                              | |
|  |                          v                                              | |
|  |  +-------------------------------------------------------------------+  | |
|  |  |                    VOICE PIPELINE                                 |  | |
|  |  |                 (voice-pipeline.ts)                               |  | |
|  |  |              Central Orchestrator                                 |  | |
|  |  |                                                                   |  | |
|  |  |   State Machine: idle -> listening -> processing -> speaking     |  | |
|  |  +-------------------------------------------------------------------+  | |
|  |               |           |           |           |                     | |
|  |               v           v           v           v                     | |
|  |  +-----------+  +--------+  +--------+  +--------+  +---------+        | |
|  |  | Audio     |  |  STT   |  |  LLM   |  |  TTS   |  | Utils   |        | |
|  |  | Pipeline  |  |Manager |  |Manager |  |Manager |  | Logger  |        | |
|  |  +-----------+  +--------+  +--------+  +--------+  +---------+        | |
|  |                                                                         | |
|  |  +---------------------------+  +------------------------------------+  | |
|  |  |      Agent System         |  |          Memory System             |  | |
|  |  |     (agent/index.ts)      |  |        (memory/index.ts)           |  | |
|  |  |  Tools: filesystem,       |  |  Conversation persistence,         |  | |
|  |  |    terminal, git          |  |  fact storage, search              |  | |
|  |  +---------------------------+  +------------------------------------+  | |
|  |                                                                         | |
|  +-------------------------------------------------------------------------+ |
|                                                                               |
+===============================================================================+
```

---

## Voice Processing Pipeline Flow

```
                              AUDIO INPUT FLOW
+-----------------------------------------------------------------------------+
|                                                                             |
|   [Microphone]                                                              |
|        |                                                                    |
|        v                                                                    |
|   +---------+     +-----------+     +-------+     +-------+                |
|   |PvRecorder|---->| Wake Word |---->|  VAD  |---->|  STT  |                |
|   | (Audio)  |     |(Porcupine)|     |(Silero)|    |Manager|                |
|   +---------+     +-----------+     +-------+     +-------+                |
|        |              |                 |             |                     |
|        |         "Hey Nova"         Speech        Transcript                |
|        |          Detected          Segment          |                      |
|        v              |                 |             v                     |
|   +--------+          +--------->-------+------>+----------+               |
|   | Audio  |                                    | Deepgram |<-- Primary    |
|   | Level  |                                    +----------+               |
|   | Events |                                         |                      |
|   +--------+                                    +----------+               |
|                                                 |   Vosk   |<-- Fallback   |
|                                                 +----------+               |
|                                                                             |
+-----------------------------------------------------------------------------+

                              RESPONSE OUTPUT FLOW
+-----------------------------------------------------------------------------+
|                                                                             |
|   [Transcript]                                                              |
|        |                                                                    |
|        v                                                                    |
|   +----------+     +----------+     +----------+     +----------+          |
|   |   LLM    |---->| Streaming|---->|   TTS    |---->|  Audio   |          |
|   | Manager  |     | Response |     | Manager  |     |  Output  |          |
|   +----------+     +----------+     +----------+     +----------+          |
|        |                                  |              |                  |
|        v                                  v              v                  |
|   +-----------+                     +-----------+   [Speaker]              |
|   | Fireworks |<-- Primary          | ElevenLabs|<-- Primary               |
|   +-----------+                     +-----------+                          |
|        |                                  |                                 |
|   +-----------+                     +-----------+                          |
|   |OpenRouter |<-- Fallback         | Piper/    |<-- Fallback              |
|   +-----------+                     | espeak    |                          |
|                                     +-----------+                          |
|                                                                             |
+-----------------------------------------------------------------------------+
```

---

## Directory Structure

```
nova-desktop/
|
+-- src/
|   |
|   +-- main/                          # ELECTRON MAIN PROCESS
|   |   |
|   |   +-- index.ts                   # App entry, window creation
|   |   +-- preload.ts                 # Secure IPC bridge
|   |   |
|   |   +-- voice/                     # Voice Processing
|   |   |   +-- voice-pipeline.ts      # Main orchestrator (STT->LLM->TTS)
|   |   |   +-- pipeline.ts            # Audio pipeline (Wake+VAD)
|   |   |   +-- wake-word.ts           # Porcupine wake word
|   |   |   +-- vad.ts                 # Silero Voice Activity Detection
|   |   |
|   |   +-- stt/                       # Speech-to-Text
|   |   |   +-- manager.ts             # Provider orchestrator
|   |   |   +-- deepgram.ts            # Cloud STT (Primary)
|   |   |   +-- vosk.ts                # Offline STT (Fallback)
|   |   |
|   |   +-- llm/                       # Large Language Models
|   |   |   +-- manager.ts             # Provider orchestrator
|   |   |   +-- fireworks.ts           # Fireworks AI (Primary)
|   |   |   +-- openrouter.ts          # OpenRouter (Fallback)
|   |   |
|   |   +-- tts/                       # Text-to-Speech
|   |   |   +-- manager.ts             # Provider orchestrator
|   |   |   +-- elevenlabs.ts          # Cloud TTS (Primary)
|   |   |   +-- offline.ts             # Piper/espeak (Fallback)
|   |   |
|   |   +-- config/                    # Configuration
|   |   |   +-- index.ts               # Env & API key validation
|   |   |
|   |   +-- ipc/                       # IPC Handlers
|   |   |   +-- handlers.ts            # Channel handlers
|   |   |   +-- factory.ts             # IPC handler factory utilities
|   |   |   +-- index.ts               # Module exports
|   |   |
|   |   +-- tray/                      # System Tray
|   |   |   +-- index.ts               # Tray menu & events
|   |   |
|   |   +-- agent/                     # Agent System (Phase 3)
|   |   |   +-- index.ts               # Agent orchestrator with tool management
|   |   |   +-- tools.ts               # Legacy tool definitions
|   |   |   +-- tools/                 # Agent tools
|   |   |       +-- index.ts           # Tool exports
|   |   |       +-- filesystem.ts      # File operations (read, write, search, copy, move)
|   |   |       +-- terminal.ts        # Command execution (npm, git, shell)
|   |   |
|   |   +-- memory/                    # Memory System
|   |   |   +-- index.ts               # MemoryManager - conversation persistence,
|   |   |                              # fact storage, session management
|   |   |
|   |   +-- types/                     # Main Process Type Definitions
|   |   |   +-- vosk.d.ts              # Vosk module type declarations
|   |   |
|   |   +-- utils/                     # Utilities
|   |       +-- errors.ts              # Error classes, CircuitBreaker
|   |       +-- logger.ts              # Winston structured logging
|   |       +-- base-manager.ts        # Abstract BaseProviderManager
|   |       +-- index.ts               # Module exports
|   |
|   +-- renderer/                      # REACT FRONTEND
|   |   |
|   |   +-- main.tsx                   # React entry point
|   |   +-- App.tsx                    # Main app component
|   |   |
|   |   +-- components/
|   |   |   +-- orb/
|   |   |   |   +-- NovaOrb.tsx        # Three.js canvas wrapper
|   |   |   |   +-- NovaParticles.tsx  # Particle system
|   |   |   |   +-- attractors.ts      # Aizawa attractor math
|   |   |   |   +-- shaders.ts         # GLSL particle shaders
|   |   |   +-- ErrorBoundary.tsx
|   |   |
|   |   +-- hooks/
|   |   |   +-- useNovaState.ts        # IPC state management
|   |   |
|   |   +-- styles/
|   |   |   +-- App.css
|   |   |   +-- index.css
|   |   |
|   |   +-- types/
|   |       +-- nova.d.ts              # Window.nova API types
|   |
|   +-- shared/                        # SHARED CODE
|       +-- types/
|           +-- index.ts               # Module exports
|           +-- config.ts              # Configuration types
|           +-- llm.ts                 # LLM types
|           +-- stt.ts                 # STT types
|           +-- tts.ts                 # TTS types
|           +-- voice.ts               # Voice pipeline types (incl. FullVoicePipelineStatus)
|           +-- agent.ts               # Agent capability & tool types
|
+-- docs/                              # Documentation
+-- tests/                             # Test files (Vitest)
+-- assets/                            # App icons
+-- dist/                              # Build output
+-- release/                           # Packaged builds
```

---

## Provider Architecture with Circuit Breaker

```
+-------------------------------------------------------------------------+
|                         PROVIDER MANAGER PATTERN                         |
+-------------------------------------------------------------------------+
|                                                                         |
|   +-------------------+                                                 |
|   |   Manager Layer   |                                                 |
|   |  (STT/LLM/TTS)    |                                                 |
|   +--------+----------+                                                 |
|            |                                                            |
|            v                                                            |
|   +--------+----------+        +--------------------+                   |
|   |  Circuit Breaker  |<------>|   State Machine    |                   |
|   |                   |        |                    |                   |
|   |  Failure Count: 3 |        |  CLOSED  (normal)  |                   |
|   |  Timeout: 60s     |        |  OPEN    (tripped) |                   |
|   |                   |        |  HALF-OPEN (test)  |                   |
|   +--------+----------+        +--------------------+                   |
|            |                                                            |
|   +--------+----------------------------+                               |
|   |                                     |                               |
|   v                                     v                               |
|   +----------------+          +------------------+                      |
|   |    PRIMARY     |          |     FALLBACK     |                      |
|   |    PROVIDER    |          |     PROVIDER     |                      |
|   |                |          |                  |                      |
|   |  - Deepgram    |          |  - Vosk          |                      |
|   |  - Fireworks   |          |  - OpenRouter    |                      |
|   |  - ElevenLabs  |          |  - Piper/espeak  |                      |
|   +----------------+          +------------------+                      |
|         |                            |                                  |
|         |  API Call                  |  Local/API Call                  |
|         v                            v                                  |
|   [ Cloud Service ]          [ Local Model / Backup API ]               |
|                                                                         |
+-------------------------------------------------------------------------+
```

---

## State Machine Diagram

```
                         VOICE PIPELINE STATES
+-------------------------------------------------------------------------+
|                                                                         |
|                            +--------+                                   |
|                            |  IDLE  |                                   |
|                            +---+----+                                   |
|                                |                                        |
|                    Wake Word / Push-to-Talk                             |
|                                |                                        |
|                                v                                        |
|                         +-----------+                                   |
|                         | LISTENING |<---------+                        |
|                         +-----+-----+          |                        |
|                               |                |                        |
|                         Speech End             | Barge-in               |
|                               |                |                        |
|                               v                |                        |
|                        +------------+          |                        |
|                        | PROCESSING |----------+                        |
|                        +-----+------+                                   |
|                              |                                          |
|                        LLM Complete                                     |
|                              |                                          |
|                              v                                          |
|                        +----------+                                     |
|                        | SPEAKING |                                     |
|                        +-----+----+                                     |
|                              |                                          |
|                        TTS Complete                                     |
|                              |                                          |
|                              v                                          |
|                            +----+                                       |
|                            |IDLE|                                       |
|                            +----+                                       |
|                                                                         |
|   ERROR state can be entered from any state and returns to IDLE         |
|                                                                         |
+-------------------------------------------------------------------------+
```

---

## IPC Communication Channels

```
+-------------------------------------------------------------------------+
|                        IPC CHANNEL MAPPING                               |
+-------------------------------------------------------------------------+
|                                                                         |
|   RENDERER (invoke)                      MAIN (handle)                  |
|   ------------------                     ---------------                |
|                                                                         |
|   nova:start          -----------------> Start voice pipeline           |
|   nova:stop           -----------------> Stop voice pipeline            |
|   nova:shutdown       -----------------> Full shutdown                  |
|   nova:get-status     -----------------> Get current status             |
|   nova:trigger-wake   -----------------> Manual wake (PTT)              |
|   nova:send-text      -----------------> Bypass STT, send text          |
|   nova:clear-history  -----------------> Clear conversation             |
|   nova:get-context    -----------------> Get conversation context       |
|   nova:get-metrics    -----------------> Get interaction metrics        |
|   nova:update-config  -----------------> Update pipeline config         |
|                                                                         |
|   MAIN (send)                            RENDERER (on)                  |
|   -----------                            -------------                  |
|                                                                         |
|   nova:state-change   -----------------> Pipeline state changed         |
|   nova:wake-word      -----------------> Wake word detected             |
|   nova:speech-start   -----------------> User started speaking          |
|   nova:speech-end     -----------------> User stopped speaking          |
|   nova:transcript-*   -----------------> Interim/final transcript       |
|   nova:response-*     -----------------> LLM response chunks            |
|   nova:audio-level    -----------------> Microphone level (~30fps)      |
|   nova:error          -----------------> Error occurred                 |
|   nova:barge-in       -----------------> User interrupted TTS           |
|                                                                         |
+-------------------------------------------------------------------------+
```

---

## Technology Stack

```
+-------------------------------------------------------------------------+
|                          TECHNOLOGY STACK                                |
+-------------------------------------------------------------------------+
|                                                                         |
|   LAYER              TECHNOLOGY              PURPOSE                    |
|   -----              ----------              -------                    |
|                                                                         |
|   Framework          Electron ^28.1.0        Desktop app framework      |
|   UI                 React ^18.2.0           Component-based UI         |
|   Language           TypeScript ^5.3.3       Type safety                |
|   Build              Vite ^5.0.10            Fast bundling              |
|   Test               Vitest ^1.1.0           Unit/integration tests    |
|                                                                         |
|   3D Graphics        Three.js ^0.160.0       WebGL rendering           |
|   React 3D           @react-three/fiber      React renderer for Three  |
|   3D Helpers         @react-three/drei       Useful Three.js utils     |
|                                                                         |
|   Wake Word          Porcupine ^4.0.1        "Hey Nova" detection      |
|   Audio Capture      PvRecorder ^1.2.8       Microphone streaming      |
|   VAD                @ricky0123/vad-node     Speech boundary detection |
|   ML Runtime         onnxruntime-node        VAD model inference       |
|                                                                         |
|   STT (Primary)      @deepgram/sdk ^4.11     Cloud transcription       |
|   STT (Fallback)     vosk-koffi ^1.1.1       Offline transcription     |
|                                                                         |
|   LLM (Primary)      Fireworks AI            Fast LLM inference        |
|   LLM (Fallback)     OpenRouter              Multi-model routing       |
|   LLM Client         openai ^6.16.0          OpenAI-compatible API     |
|                                                                         |
|   TTS (Primary)      elevenlabs ^1.59.0      High-quality voice        |
|   TTS (Fallback)     Piper/espeak            Offline synthesis         |
|                                                                         |
|   State              Zustand ^4.4.7          Lightweight state mgmt    |
|   Logging            Winston ^3.11.0         Structured logging        |
|   Storage            electron-store ^8.1.0   Persistent config         |
|   Config             dotenv ^16.3.1          Environment variables     |
|                                                                         |
+-------------------------------------------------------------------------+
```

---

## Environment Variables

```
+-------------------------------------------------------------------------+
|                      REQUIRED ENVIRONMENT VARIABLES                      |
+-------------------------------------------------------------------------+
|                                                                         |
|   Variable                   Provider          Purpose                  |
|   --------                   --------          -------                  |
|                                                                         |
|   PORCUPINE_API_KEY          Picovoice         Wake word detection     |
|   DEEPGRAM_API_KEY           Deepgram          Cloud STT               |
|   FIREWORKS_API_KEY          Fireworks AI      Primary LLM             |
|   ELEVENLABS_API_KEY         ElevenLabs        Cloud TTS               |
|                                                                         |
+-------------------------------------------------------------------------+
|                      OPTIONAL ENVIRONMENT VARIABLES                      |
+-------------------------------------------------------------------------+
|                                                                         |
|   OPENROUTER_API_KEY         OpenRouter        Fallback LLM            |
|   LOG_LEVEL                  -                 debug/info/warn/error   |
|   NOVA_ENV                   -                 development/production  |
|   ELEVENLABS_VOICE_ID        ElevenLabs        Custom voice ID         |
|                                                                         |
+-------------------------------------------------------------------------+
```

---

## Data Flow Summary

```
+===========================================================================+
|                           COMPLETE DATA FLOW                               |
+===========================================================================+
|                                                                           |
|   USER                                                                    |
|    |                                                                      |
|    | "Hey Nova, what's the weather?"                                      |
|    v                                                                      |
|   +-------------+                                                         |
|   | Microphone  | (16kHz, mono, PCM)                                      |
|   +------+------+                                                         |
|          |                                                                |
|          v                                                                |
|   +------+------+    +-------------+    +-------------+                   |
|   | Wake Word   |--->| VAD         |--->| STT         |                   |
|   | (Porcupine) |    | (Silero)    |    | (Deepgram)  |                   |
|   +-------------+    +-------------+    +------+------+                   |
|                                                |                          |
|                                                v                          |
|                                    "what's the weather"                   |
|                                                |                          |
|                                                v                          |
|                                    +----------+----------+                |
|                                    |      LLM Manager    |                |
|                                    |    (Fireworks AI)   |                |
|                                    +----------+----------+                |
|                                               |                           |
|                                               v                           |
|                          "The weather today is sunny with..."             |
|                                               |                           |
|                                               v                           |
|                                    +----------+----------+                |
|                                    |     TTS Manager     |                |
|                                    |    (ElevenLabs)     |                |
|                                    +----------+----------+                |
|                                               |                           |
|                                               v                           |
|                                    +----------+----------+                |
|                                    |      Speaker        |                |
|                                    +---------------------+                |
|                                               |                           |
|   USER                                        v                           |
|    ^                                     [Audio Output]                   |
|    |                                                                      |
|    +-- hears response                                                     |
|                                                                           |
+===========================================================================+
```

---

## Changelog

**Updated by TERMINAL_1 on 2026-01-13 (session-008):**

- Added `src/main/types/` directory with `vosk.d.ts`
- Added `src/main/ipc/factory.ts` (IPC handler factory utilities)
- Added `src/main/ipc/index.ts` (module exports)
- Added `src/main/utils/base-manager.ts` (Abstract BaseProviderManager)
- Added `src/main/utils/index.ts` (module exports)
- Added `src/shared/types/index.ts` (module exports)
- Updated `voice.ts` note to mention `FullVoicePipelineStatus`
- Bumped version to 0.1.1

**Updated by TERMINAL_1 on 2026-01-13 (session-013):**

- Added `src/main/agent/` directory with Agent orchestrator (Phase 3)
- Added `src/main/agent/index.ts` (Agent class with tool management)
- Added `src/main/agent/tools/` directory with agent tools
- Added `src/main/agent/tools/filesystem.ts` (file operations: read, write, search, copy, move, delete, mkdir)
- Added `src/main/agent/tools/terminal.ts` (command execution: npm, git, shell with safety validation)
- Added `src/main/memory/index.ts` (MemoryManager - conversation persistence, fact storage)
- Added `src/shared/types/agent.ts` (Agent capability & tool types)
- Updated high-level architecture diagram to show Agent & Memory systems
- Updated directory structure with new modules
- Tests: 690/690 passing
- Bumped version to 0.1.2
