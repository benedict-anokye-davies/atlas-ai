# Nova Phase 1: Voice Pipeline - Week-by-Week Breakdown

**Goal**: Functional voice assistant with animated responses by January 16, 2026  
**Duration**: 2 weeks (Jan 13-16 for MVP, then polish post-exams)  
**Status**: Ready to start NOW

---

## WEEK 1: Foundation + Voice Detection

### Day 1 (Monday, Jan 13)
**Focus**: Project setup, environment configuration, dependency installation

#### Morning (2-3 hours)
- [ ] Create GitHub repo: `nova-desktop`
- [ ] Clone starter boilerplate (use NOVA_GITHUB_STARTER.md as template)
- [ ] Initialize npm: `npm init -y`
- [ ] Install core dependencies:
  ```bash
  npm install electron react react-dom typescript zustand
  npm install --save-dev webpack webpack-cli webpack-dev-middleware
  npm install --save-dev @types/node @types/react electron-webpack
  ```
- [ ] Set up TypeScript config (`tsconfig.json`)
- [ ] Create directory structure (see NOVA_GITHUB_STARTER.md)

#### Afternoon (2-3 hours)
- [ ] Create `.env.example` file with all required API keys (DON'T add secrets yet)
- [ ] Install Electron builder: `npm install --save-dev electron-builder`
- [ ] Create `public/electron.js` (main process entry point)
- [ ] Create `src/index.tsx` (React entry point)
- [ ] Test: `npm run dev` should start without errors (might show blank window)

**Success Criteria**:
- ✅ Electron window opens (blank is fine)
- ✅ No console errors
- ✅ Hot-reload works (edit code, window updates)

**Deliverable**: Basic Electron + React boilerplate running

---

### Day 2 (Tuesday, Jan 14)
**Focus**: Porcupine wake word detection setup

#### Morning (2-3 hours)
- [ ] Install Porcupine: `npm install @picovoice/porcupine-node`
- [ ] Create `src/main/voice/porcupine.ts`:
  ```typescript
  import { Porcupine, BuiltInKeyword } from '@picovoice/porcupine-node';
  
  export class WakeWordDetector {
    private porcupine: Porcupine;
    
    constructor(accessKey: string) {
      this.porcupine = new Porcupine(
        accessKey,
        [BuiltInKeyword.GRAPEFRUIT], // "Hey Google" - closest to "Hey Nova"
        [0.5]
      );
    }
    
    process(pcmData: Int16Array): number {
      return this.porcupine.process(pcmData);
    }
  }
  ```
- [ ] Get Porcupine free tier key from picovoice.ai (or trial)
- [ ] Add to `.env`: `PORCUPINE_ACCESS_KEY=your_key`
- [ ] Create `src/main/ipc/voice.ts` IPC handler
- [ ] Test Porcupine with microphone input

#### Afternoon (2-3 hours)
- [ ] Install audio capture library: `npm install audio-context-monitor` or `node-portaudio`
- [ ] Set up microphone stream
- [ ] Feed audio to Porcupine
- [ ] Log when wake word detected

**Success Criteria**:
- ✅ Say "Hey Google" (placeholder for "Hey Nova") into mic
- ✅ Console logs "Wake word detected!"
- ✅ No crashes

**Deliverable**: Basic wake word detection working

---

### Day 3 (Wednesday, Jan 14)
**Focus**: Deepgram speech-to-text integration

#### Morning (2-3 hours)
- [ ] Install Deepgram SDK: `npm install @deepgram/sdk`
- [ ] Get free Deepgram API key from deepgram.com
- [ ] Add to `.env`: `DEEPGRAM_API_KEY=your_key`
- [ ] Create `src/main/voice/deepgram.ts`:
  ```typescript
  import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
  
  export class SpeechToText {
    async startListening(onTranscript: (text: string) => void) {
      const deepgram = createClient(process.env.DEEPGRAM_API_KEY!);
      const connection = deepgram.listen.live({
        model: 'nova-3',
        language: 'en',
        smart_format: true,
        interim_results: true
      });
      
      connection.on(LiveTranscriptionEvents.Transcript, (data) => {
        const transcript = data.channel.alternatives[0].transcript;
        if (!data.is_final) {
          onTranscript(transcript);
        }
      });
    }
  }
  ```

#### Afternoon (2-3 hours)
- [ ] Create IPC handler for STT
- [ ] Connect Porcupine → Deepgram flow:
  - When wake word detected → start listening to Deepgram
  - Stream transcript to renderer
  - Display in console
- [ ] Test: Say something after "Hey Google", see transcript appear

**Success Criteria**:
- ✅ Say "Hey Google, what time is it?"
- ✅ Console shows: "what time is it"
- ✅ Latency <500ms for transcription

**Deliverable**: Speech-to-text working end-to-end

---

### Day 4 (Thursday, Jan 15)
**Focus**: LLM integration (Fireworks AI)

#### Morning (2-3 hours)
- [ ] Install Anthropic SDK: `npm install @anthropic-ai/sdk`
- [ ] Get Fireworks API key (or use Anthropic directly for MVP)
- [ ] Add to `.env`: `ANTHROPIC_API_KEY=your_key`
- [ ] Create `src/main/llm/llmEngine.ts`:
  ```typescript
  import Anthropic from '@anthropic-ai/sdk';
  
  export class LLMEngine {
    private client: Anthropic;
    
    constructor() {
      this.client = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY
      });
    }
    
    async *generateResponse(query: string) {
      const stream = this.client.messages.stream({
        model: 'claude-opus-4-1-20250805',
        max_tokens: 1024,
        system: 'You are Nova, a helpful AI assistant.',
        messages: [{ role: 'user', content: query }]
      });
      
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta') {
          yield chunk.delta.text;
        }
      }
    }
  }
  ```

#### Afternoon (2-3 hours)
- [ ] Create IPC handler for LLM streaming
- [ ] Connect transcribed text → LLM → token streaming
- [ ] Test: Ask Nova a question, see tokens stream in console

**Success Criteria**:
- ✅ Say: "Hey Google, what's the capital of France?"
- ✅ Nova responds: "The capital of France is Paris"
- ✅ Tokens appear in real-time (not all at once)

**Deliverable**: LLM streaming working

---

### Day 5 (Friday, Jan 15)
**Focus**: ElevenLabs text-to-speech

#### Morning (2-3 hours)
- [ ] Install ElevenLabs SDK: `npm install @elevenlabs/elevenlabs-js`
- [ ] Get ElevenLabs API key and choose male voice (Onyx recommended)
- [ ] Add to `.env`: `ELEVENLABS_API_KEY=your_key`
- [ ] Create `src/main/voice/elevenlabs.ts`:
  ```typescript
  import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
  
  export class TextToSpeech {
    private client: ElevenLabsClient;
    
    constructor() {
      this.client = new ElevenLabsClient({
        apiKey: process.env.ELEVENLABS_API_KEY
      });
    }
    
    async speak(text: string, voiceId: string = 'onyx') {
      const audioStream = await this.client.textToSpeech.stream(voiceId, {
        text,
        model_id: 'eleven_turbo_v2'
      });
      
      // Play audio
      for await (const chunk of audioStream) {
        this.playAudio(chunk);
      }
    }
  }
  ```

#### Afternoon (2-3 hours)
- [ ] Create audio playback using Web Audio API or node-speaker
- [ ] Connect LLM response → TTS → speaker
- [ ] Test: Hear Nova speak the response

**Success Criteria**:
- ✅ Say: "Hey Google, tell me a joke"
- ✅ Hear Nova say: "Why did the AI go to school? To improve its learning models!"
- ✅ Voice sounds natural (Onyx male voice)

**Deliverable**: Complete voice loop working

---

## WEEK 2: Polish + Renderer UI

### Day 6 (Monday, Jan 15)
**Focus**: IPC architecture + state management

#### Morning (2-3 hours)
- [ ] Set up Zustand store for agent state:
  ```typescript
  import create from 'zustand';
  
  interface NovaState {
    state: 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING';
    transcript: string;
    response: string;
  }
  
  export const useNovaStore = create<NovaState>((set) => ({
    state: 'IDLE',
    transcript: '',
    response: '',
    setState: (state) => set({ state }),
    setTranscript: (transcript) => set({ transcript }),
    setResponse: (response) => set({ response })
  }));
  ```
- [ ] Create typed IPC channels:
  ```typescript
  // src/main/ipc/handlers.ts
  ipcMain.on('agent:state-change', (event, newState) => {
    mainWindow.webContents.send('agent:state', newState);
  });
  ```

#### Afternoon (2-3 hours)
- [ ] Connect voice pipeline to Zustand
- [ ] Emit state changes from main process to renderer
- [ ] Test: See state changes reflected in React

**Success Criteria**:
- ✅ State changes flow main → renderer
- ✅ React components can read state

---

### Day 7 (Tuesday, Jan 16)
**Focus**: Minimal UI + polish for demo

#### Morning (2-3 hours)
- [ ] Create `src/renderer/App.tsx` with minimal UI:
  ```typescript
  export function App() {
    const { state, transcript, response } = useNovaStore();
    
    return (
      <div style={{ textAlign: 'center', padding: '20px' }}>
        <h1>Nova</h1>
        <div>State: {state}</div>
        <div>Transcript: {transcript}</div>
        <div>Response: {response}</div>
      </div>
    );
  }
  ```
- [ ] Add basic CSS for readability
- [ ] Add toggle button to enable/disable listening
- [ ] Add "Stop" button to interrupt

#### Afternoon (2-3 hours)
- [ ] Test full voice loop end-to-end:
  1. Press enable listening
  2. Say "Hey Google, hi"
  3. Hear response
- [ ] Fix any bugs
- [ ] Record demo video

**Success Criteria**:
- ✅ Full voice loop works (wake word → STT → LLM → TTS)
- ✅ UI shows state changes
- ✅ Can toggle listening on/off
- ✅ 30-second demo recorded

**Deliverable**: DEMO - Voice assistant working!

---

### Day 8 (Wednesday, Jan 16)
**Focus**: Polish + backup plan

#### Morning (2-3 hours)
- [ ] Test on your actual RTX 3060 laptop
- [ ] Fix latency issues (if any)
- [ ] Improve audio quality (mic input settings)
- [ ] Test interrupting TTS (stop speaking when you talk)
- [ ] Add error handling (graceful failures)

#### Afternoon (2-3 hours)
- [ ] Clean up console logs
- [ ] Commit to GitHub
- [ ] Write minimal README
- [ ] Document next steps for Phase 2

**Success Criteria**:
- ✅ Works smoothly on real hardware
- ✅ Code is pushed to GitHub
- ✅ Can pick up Phase 2 after exams

---

## PHASE 1 FINAL CHECKLIST

### Voice Pipeline
- [ ] Porcupine wake word detects "Hey Google"/"Hey Nova"
- [ ] Deepgram transcribes spoken text
- [ ] Fireworks AI responds with relevant answers
- [ ] ElevenLabs speaks response in male voice
- [ ] Full loop: wake word → transcript → response → audio

### IPC & State
- [ ] Main ↔ Renderer communication works
- [ ] State changes propagate to UI
- [ ] No blocking operations in main thread

### UI (Minimal)
- [ ] Shows current state (IDLE/LISTENING/THINKING/SPEAKING)
- [ ] Shows transcript as you speak
- [ ] Shows response text
- [ ] Toggle listening button
- [ ] Stop button

### Testing
- [ ] Tested on RTX 3060 laptop (your hardware)
- [ ] No crashes after 5+ minute use
- [ ] Latency acceptable (<2 second response time)
- [ ] Audio quality good

### Documentation
- [ ] Code pushed to GitHub
- [ ] README created
- [ ] API keys documented in .env.example
- [ ] Next steps for Phase 2 written

---

## CONTINGENCY PLANS

### If Porcupine fails:
→ Use Vosk open-source alternative (lower accuracy but free)

### If Deepgram rate-limited:
→ Fall back to local Vosk STT (slower but works offline)

### If Fireworks/Anthropic API fails:
→ Use OpenRouter Claude fallback
→ Or run local Qwen 7B via Ollama

### If ElevenLabs TTS too expensive:
→ Use free tier or switch to Coqui XTTS-v2 (offline, but slower)

### If latency too high:
→ Use local smaller model (Phi-3) instead of Fireworks
→ Cache common responses

---

## POST-PHASE 1: NEXT STEPS

Once voice is working:

1. **January 17-23** (After exams):
   - Build Orb visualization (React Three Fiber)
   - Implement state-based colors/behavior

2. **January 24-31**:
   - Implement memory system (Mem0 + LanceDB)
   - Add conversation history storage

3. **February+**:
   - Add autonomous research loop
   - Implement browser automation (Playwright)
   - Add trading bot integration

---

## RESOURCES

- Electron Docs: https://www.electronjs.org/docs
- React Docs: https://react.dev
- Deepgram SDK: https://github.com/deepgram/deepgram-js-sdk
- ElevenLabs API: https://elevenlabs.io/docs/api-reference
- Anthropic API: https://docs.anthropic.com/

---

## SUPPORT

**If you get stuck:**
1. Check GitHub Issues (open a new one)
2. Review code examples in NOVA_REBUILD_PLAN.md
3. Run research queries on Perplexity (see NOVA_PERPLEXITY_RESEARCH.md)
4. Try fallback options (see Contingency Plans section)

---

## SUCCESS METRIC

**By January 16, 2026 11:59 PM:**

✅ You can say "Hey Nova, tell me a joke" and hear Nova laugh back.

That's the MVP. Everything else comes after.

**You've got this. Start today! 🚀**
