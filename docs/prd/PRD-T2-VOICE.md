# PRD-T2: Voice Pipeline

Terminal: T2
Role: Voice Pipeline Engineer
Status: NOT_STARTED

## Objective

Implement a complete voice interaction system for Atlas with:

- Wake word detection ("Hey Atlas")
- Voice activity detection (Picovoice Cobra)
- Speech-to-text (Deepgram)
- LLM processing (Fireworks DeepSeek V3)
- Text-to-speech (ElevenLabs)
- Barge-in support (user can interrupt)

## File Ownership

You own these files exclusively. No other terminal will modify them.

```
src/main/voice/
src/main/stt/
src/main/tts/
src/main/llm/
src/renderer/hooks/useAtlasState.ts
```

## Architecture

```
                    VOICE PIPELINE

User speaks "Hey Atlas"
         |
         v
+------------------+
|   Wake Word      |  Porcupine (Picovoice)
|   Detection      |  Listens continuously
+--------+---------+
         |
         v  (wake word detected)
+------------------+
|   Voice Activity |  Picovoice Cobra (NOT Silero)
|   Detection      |  99% accuracy, 0.05% CPU
+--------+---------+
         |
         v  (speech segment)
+------------------+
|   Speech-to-Text |  Deepgram Nova-3
|   (Streaming)    |  WebSocket, real-time
+--------+---------+
         |
         v  (transcript)
+------------------+
|   LLM Processing |  Fireworks DeepSeek V3.2
|                  |  Streaming response
+--------+---------+
         |
         v  (response text)
+------------------+
|   Text-to-Speech |  ElevenLabs
|   (Streaming)    |  WebSocket, real-time
+--------+---------+
         |
         v
     Audio output
```

## State Machine

Implement these states in the voice pipeline:

```
IDLE -----(wake word)-----> LISTENING
LISTENING --(speech end)--> PROCESSING
PROCESSING --(response)---> SPEAKING
SPEAKING ---(complete)----> IDLE
SPEAKING ---(barge-in)----> LISTENING  (user interrupts)
```

State transitions must be atomic. Only one state active at a time.

## Tasks

### Phase 1: Core Pipeline

#### T2-001: Verify Porcupine Wake Word

File: `src/main/voice/wake-word.ts`

Requirements:

- Initialize Porcupine with "Hey Atlas" or built-in keyword
- Continuous listening on default microphone
- Emit event when wake word detected
- Handle errors gracefully

Verification:

```
1. Start application
2. Say "Hey Atlas"
3. Confirm detection logged to console
4. Confirm no false positives during normal speech
```

#### T2-002: Replace Silero with Picovoice Cobra

File: `src/main/voice/vad.ts`

The current implementation uses Silero VAD. Replace with Picovoice Cobra.

Install:

```bash
npm install @picovoice/cobra-node
```

Requirements:

- Initialize Cobra with Picovoice access key
- Process audio frames (512 samples at 16kHz)
- Return voice probability (0.0 to 1.0)
- Threshold at 0.5 for speech detection
- Emit events: speech_start, speech_end

Verification:

```
1. Speak into microphone
2. Confirm speech_start fires within 100ms
3. Stop speaking
4. Confirm speech_end fires within 500ms
5. Confirm no false triggers from background noise
```

#### T2-003: Verify Deepgram STT

File: `src/main/stt/deepgram.ts`

Requirements:

- WebSocket connection to Deepgram
- Model: nova-2 (or nova-3 if available)
- Streaming audio input
- Interim results for responsiveness
- Final transcript on speech end

Verification:

```
1. Speak "Hello, my name is Atlas"
2. Confirm interim results appear
3. Confirm final transcript is accurate
4. Confirm latency under 300ms
```

#### T2-004: Verify Fireworks LLM

File: `src/main/llm/fireworks.ts`

Requirements:

- HTTP streaming to Fireworks API
- Model: accounts/fireworks/models/deepseek-v3-0324
- System prompt with Atlas personality
- Stream tokens as they arrive

Verification:

```
1. Send "What is 2+2?"
2. Confirm response streams (not all at once)
3. Confirm response is correct
4. Confirm first token under 2 seconds
```

#### T2-005: Verify ElevenLabs TTS

File: `src/main/tts/elevenlabs.ts`

Requirements:

- WebSocket streaming to ElevenLabs
- Voice ID configurable
- Stream audio chunks as they arrive
- Play through system audio

Verification:

```
1. Send "Hello, I am Atlas"
2. Confirm audio plays
3. Confirm audio starts within 500ms
4. Confirm voice sounds natural
```

#### T2-006: Wire Full Pipeline

File: `src/main/voice/voice-pipeline.ts`

Requirements:

- Orchestrate all components
- State machine implementation
- Event flow: wake -> vad -> stt -> llm -> tts
- Error handling at each stage
- Timeout handling (30 second max per stage)

Verification:

```
1. Say "Hey Atlas"
2. Wait for listening indicator
3. Say "What time is it?"
4. Confirm Atlas responds with time
5. Total time under 5 seconds
```

### Phase 2: Barge-In Support

#### T2-007: Voice State Machine

File: `src/main/voice/voice-pipeline.ts`

Requirements:

- Enum for states: IDLE, LISTENING, PROCESSING, SPEAKING
- Transition functions with validation
- State change events for renderer
- Prevent invalid transitions

Implementation:

```typescript
type VoiceState = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING';

interface VoicePipeline {
  state: VoiceState;
  transition(newState: VoiceState): void;
  onStateChange(callback: (state: VoiceState) => void): void;
}
```

#### T2-008: Barge-In Detection

File: `src/main/voice/voice-pipeline.ts`

Requirements:

- Continue VAD during SPEAKING state
- Detect speech while TTS is playing
- Cancel TTS immediately on detection (AbortController)
- Flush audio buffers
- Transition to LISTENING
- Resume STT for new input

Verification:

```
1. Ask Atlas a question
2. While Atlas is responding, start speaking
3. Confirm Atlas stops within 200ms
4. Confirm Atlas starts listening to you
5. Complete your new request
6. Confirm Atlas responds to new request
```

#### T2-009: IPC Events for Renderer

File: `src/main/ipc/voice-handlers.ts` (create if needed)

Requirements:

- IPC channel: voice:state-change
- IPC channel: voice:transcript (partial and final)
- IPC channel: voice:response (LLM response text)
- IPC channel: voice:error

Register in preload.ts:

```typescript
contextBridge.exposeInMainWorld('atlas', {
  voice: {
    onStateChange: (callback) => ipcRenderer.on('voice:state-change', callback),
    onTranscript: (callback) => ipcRenderer.on('voice:transcript', callback),
    onResponse: (callback) => ipcRenderer.on('voice:response', callback),
    onError: (callback) => ipcRenderer.on('voice:error', callback),
  },
});
```

### Phase 3: Orb Integration

#### T2-010: Update useAtlasState Hook

File: `src/renderer/hooks/useAtlasState.ts`

Requirements:

- Subscribe to IPC events from main process
- Expose current state to components
- Expose transcript and response
- Handle cleanup on unmount

Interface:

```typescript
interface AtlasState {
  voiceState: 'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING';
  transcript: string;
  response: string;
  error: string | null;
}
```

#### T2-011: Test Orb Integration

Requirements:

- Orb animation changes based on voiceState
- IDLE: Calm, slow movement
- LISTENING: Active, responsive
- PROCESSING: Pulsing, thinking
- SPEAKING: Rhythmic, output-based

Verification:

```
1. Observe orb in IDLE state
2. Say "Hey Atlas" - orb should become active
3. Speak - orb should show listening animation
4. Wait for processing - orb should pulse
5. Listen to response - orb should animate with speech
```

## Dependencies

Required packages (install when needed):

```
@picovoice/porcupine-node  (wake word)
@picovoice/cobra-node      (VAD)
```

Existing packages (already installed):

```
deepgram SDK
elevenlabs SDK
```

## API Keys Required

Verify these are in .env:

```
PORCUPINE_API_KEY=xxx
DEEPGRAM_API_KEY=xxx
ELEVENLABS_API_KEY=xxx
FIREWORKS_API_KEY=xxx
```

## Quality Checklist

Before marking any task DONE:

- [ ] Code compiles without errors
- [ ] No TypeScript warnings
- [ ] Manual test passes
- [ ] Error cases handled
- [ ] Console logs removed (use logger instead)

## Performance Targets

| Metric              | Target   |
| ------------------- | -------- |
| Wake word detection | < 200ms  |
| VAD speech start    | < 100ms  |
| STT first word      | < 300ms  |
| LLM first token     | < 2000ms |
| TTS first audio     | < 500ms  |
| Barge-in response   | < 200ms  |
| Full loop           | < 5000ms |

## Common Issues

### Porcupine not detecting

- Check API key is valid
- Check microphone permissions
- Check audio device is correct

### Deepgram connection fails

- Check API key
- Check network connectivity
- Check WebSocket URL format

### ElevenLabs audio choppy

- Check audio buffer size
- Check streaming implementation
- Check audio device sample rate

## Notes

- Use Picovoice Cobra for VAD, NOT Silero (per research)
- All audio processing on main process (not renderer)
- IPC for all renderer communication
- Log all state transitions for debugging
