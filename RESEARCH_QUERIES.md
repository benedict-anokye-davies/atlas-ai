# Nova Research Queries

Pre-planned research queries for development phases.
Run with: `./scripts/research.sh "query"`

---

## Phase 1: Voice Pipeline

### Setup
- [ ] "Electron React TypeScript Vite boilerplate 2024 best practices"
- [ ] "Electron builder configuration Windows Mac Linux"

### Wake Word
- [ ] "Porcupine wake word Node.js Electron integration tutorial 2024"
- [ ] "Custom wake word training Picovoice console"

### STT
- [ ] "Deepgram Nova-3 streaming transcription TypeScript example"
- [ ] "Deepgram SDK Node.js real-time audio stream"
- [ ] "Vosk offline speech recognition Node.js small model"

### VAD
- [ ] "Silero VAD Node.js implementation ricky0123"
- [ ] "Voice activity detection JavaScript browser"

### LLM
- [ ] "Fireworks AI DeepSeek R1 API TypeScript streaming"
- [ ] "OpenAI compatible API streaming responses Node.js"

### TTS
- [ ] "ElevenLabs streaming TTS Node.js implementation"
- [ ] "ElevenLabs WebSocket API TypeScript example"
- [ ] "say.js Node.js text to speech cross platform"

### Audio
- [ ] "Node.js audio input stream microphone Windows"
- [ ] "node-record-lpcm16 Windows compatibility"
- [ ] "Web Audio API Electron recording"

---

## Phase 2: Visual Orb

- [ ] "React Three Fiber particle system 50000 particles performance"
- [ ] "Aizawa attractor implementation Three.js"
- [ ] "Three.js GPU instancing particles"
- [ ] "React Three Fiber postprocessing bloom effect"
- [ ] "Zustand state management React Three Fiber"

---

## Phase 3: Agent & Tools

- [ ] "Playwright browser automation Node.js"
- [ ] "Node.js file system operations security best practices"
- [ ] "child_process spawn terminal commands Node.js"
- [ ] "Simple Git Node.js library"
- [ ] "DuckDuckGo search API Node.js"

---

## Phase 4: Memory System

- [ ] "LanceDB vector database Node.js setup"
- [ ] "Mem0 AI memory integration JavaScript"
- [ ] "HyDE hypothetical document embeddings implementation"
- [ ] "Vector similarity search LanceDB"
- [ ] "Sentence transformers Node.js embeddings"

---

## Usage

```bash
# Single query
./scripts/research.sh "Porcupine wake word Node.js"

# Save to file
./scripts/research.sh "Deepgram streaming API" > docs/deepgram-research.md

# Batch research (run all Phase 1 queries)
cat RESEARCH_QUERIES.md | grep "\- \[ \]" | sed 's/- \[ \] "//' | sed 's/"$//' | while read q; do
    ./scripts/research.sh "$q" >> docs/research-results.md
    sleep 2  # Rate limit
done
```

---

## Alternative: OpenCode Research

If Perplexity API isn't available, OpenCode can do research:

```bash
opencode -p "Research: How to implement Porcupine wake word in Electron with Node.js. 
Provide:
1. NPM packages needed
2. Code example
3. Common pitfalls
4. Windows-specific considerations"
```
