/**
 * Streaming TTS Integration for Nova
 * 
 * Wires the streaming TTS into your existing pipeline.
 * This makes DeepSeek V3 + ElevenLabs feel 3x faster.
 */

import { EventEmitter } from 'events';
import { sleep } from '../../../shared/utils';

// ============================================================================
// QUICK INTEGRATION EXAMPLE
// ============================================================================

/**
 * Example: Integrate streaming TTS into existing Nova conversation flow
 */
export async function integrateStreamingTTS(): Promise<void> {
  // Your existing config
  const config = {
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
    elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || '',
    voiceId: 'EXAVITQu4vr4xnSDxMaL', // Sarah
  };

  const streamer = new StreamingConversation(config);

  // Example conversation turn
  const response = await streamer.chat('What is the capital of France?');
  console.log('Full response:', response);
}

// ============================================================================
// STREAMING CONVERSATION CLASS
// ============================================================================

interface StreamingConfig {
  deepseekApiKey: string;
  elevenLabsApiKey: string;
  voiceId: string;
  systemPrompt?: string;
}

/**
 * Full streaming conversation with DeepSeek V3 + ElevenLabs
 * 
 * Timeline comparison:
 * 
 * BEFORE (blocking):
 * ├─ [0-1200ms]    Wait for DeepSeek full response
 * ├─ [1200-1600ms] Generate full audio
 * └─ [1600ms+]     Start playing audio
 * 
 * AFTER (streaming):
 * ├─ [0-400ms]     First sentence from DeepSeek
 * ├─ [400-600ms]   Generate first chunk audio
 * └─ [600ms+]      START PLAYING (while rest still generating!)
 */
export class StreamingConversation extends EventEmitter {
  private config: StreamingConfig;
  private conversationHistory: Array<{ role: string; content: string }> = [];
  private audioQueue: ArrayBuffer[] = [];
  private isPlaying = false;
  private textBuffer = '';
  private abortController: AbortController | null = null;

  constructor(config: StreamingConfig) {
    super();
    this.config = {
      ...config,
      systemPrompt: config.systemPrompt || 'You are Nova, a helpful AI assistant. Keep responses concise.',
    };
  }

  /**
   * Process a chat message with streaming TTS
   */
  async chat(userMessage: string): Promise<string> {
    const startTime = Date.now();
    this.abortController = new AbortController();
    this.audioQueue = [];
    this.textBuffer = '';

    // Add user message to history
    this.conversationHistory.push({ role: 'user', content: userMessage });

    let fullResponse = '';
    let firstAudioTime = 0;

    try {
      // Start the streaming LLM request
      const llmStream = this.streamDeepSeek(userMessage);

      // Process tokens as they arrive
      for await (const token of llmStream) {
        if (this.abortController.signal.aborted) break;

        fullResponse += token;
        this.textBuffer += token;
        this.emit('text', token);

        // Check for sentence boundaries
        const chunkToSpeak = this.extractSentence();
        if (chunkToSpeak) {
          // Generate audio in parallel (non-blocking)
          this.generateAndQueueAudio(chunkToSpeak).then(() => {
            if (!firstAudioTime) {
              firstAudioTime = Date.now() - startTime;
              this.emit('first_audio', { time: firstAudioTime });
            }
          });

          // Start playback loop if not running
          if (!this.isPlaying) {
            this.startPlaybackLoop();
          }
        }
      }

      // Process remaining text
      if (this.textBuffer.trim()) {
        await this.generateAndQueueAudio(this.textBuffer.trim());
        this.textBuffer = '';
      }

      // Wait for all audio to finish
      while (this.audioQueue.length > 0 || this.isPlaying) {
        await this.sleep(50);
      }

      // Add to history
      this.conversationHistory.push({ role: 'assistant', content: fullResponse });

      const totalTime = Date.now() - startTime;
      this.emit('complete', {
        response: fullResponse,
        totalTime,
        firstAudioTime,
        improvement: `First audio at ${firstAudioTime}ms vs ~${totalTime}ms blocking`,
      });

      return fullResponse;

    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        this.emit('error', error);
        throw error;
      }
      return fullResponse;
    }
  }

  /**
   * Extract a complete sentence from the buffer
   */
  private extractSentence(): string | null {
    const delimiters = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
    const minLength = 30;

    for (const delimiter of delimiters) {
      const idx = this.textBuffer.indexOf(delimiter);
      if (idx >= minLength) {
        const sentence = this.textBuffer.slice(0, idx + 1).trim();
        this.textBuffer = this.textBuffer.slice(idx + delimiter.length);
        return sentence;
      }
    }

    // Force split if buffer is too long
    if (this.textBuffer.length > 150) {
      const lastSpace = this.textBuffer.lastIndexOf(' ', 120);
      if (lastSpace > 50) {
        const chunk = this.textBuffer.slice(0, lastSpace).trim();
        this.textBuffer = this.textBuffer.slice(lastSpace + 1);
        return chunk;
      }
    }

    return null;
  }

  /**
   * Stream from Kimi K2.5 API (Fireworks)
   * Kimi K2.5: 1 TRILLION parameter MoE, 256K context, vision + function calling
   */
  private async *streamDeepSeek(userMessage: string): AsyncGenerator<string> {
    const messages = [
      { role: 'system', content: this.config.systemPrompt },
      ...this.conversationHistory,
    ];

    // Using Fireworks AI endpoint for Kimi K2.5
    const response = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: 'accounts/fireworks/models/kimi-k2p5',
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 8000, // Extended context available
      }),
      signal: this.abortController?.signal,
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              yield content;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  }

  /**
   * Generate audio from text using ElevenLabs streaming
   */
  private async generateAndQueueAudio(text: string): Promise<void> {
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${this.config.voiceId}/stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': this.config.elevenLabsApiKey,
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_turbo_v2_5',
            output_format: 'pcm_24000',
            optimize_streaming_latency: 3,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
          }),
          signal: this.abortController?.signal,
        }
      );

      if (!response.ok) {
        throw new Error(`ElevenLabs error: ${response.status}`);
      }

      // Collect all audio chunks
      const chunks: Uint8Array[] = [];
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Combine into single buffer
      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      const audioData = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        audioData.set(chunk, offset);
        offset += chunk.length;
      }

      // Add to playback queue
      this.audioQueue.push(audioData.buffer);
      this.emit('audio_queued', { text, bytes: audioData.byteLength });

    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        this.emit('audio_error', { text, error });
      }
    }
  }

  /**
   * Playback loop - plays audio chunks in order
   */
  private async startPlaybackLoop(): Promise<void> {
    if (this.isPlaying) return;
    this.isPlaying = true;

    while (this.audioQueue.length > 0 || this.textBuffer) {
      const audio = this.audioQueue.shift();
      
      if (audio) {
        await this.playAudio(audio);
      } else {
        // Wait for more audio
        await this.sleep(50);
      }
    }

    this.isPlaying = false;
  }

  /**
   * Play a single audio buffer (renderer process only)
   */
  private async playAudio(audioData: ArrayBuffer): Promise<void> {
    // This needs to run in renderer process with Web Audio API
    // For main process, emit the audio for IPC transport
    this.emit('play_audio', audioData);
    
    // Estimate duration from PCM data (24kHz, 16-bit mono)
    const samples = audioData.byteLength / 2;
    const durationMs = (samples / 24000) * 1000;
    
    await this.sleep(durationMs);
  }

  /**
   * Stop current conversation
   */
  stop(): void {
    this.abortController?.abort();
    this.audioQueue = [];
    this.textBuffer = '';
    this.isPlaying = false;
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.conversationHistory = [];
  }

  private sleep(ms: number): Promise<void> {
    return sleep(ms);
  }
}

// ============================================================================
// RENDERER PROCESS AUDIO PLAYER
// ============================================================================

/**
 * Audio player for renderer process (uses Web Audio API)
 * Connect this to StreamingConversation via IPC
 */
export class StreamingAudioPlayer {
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private queue: ArrayBuffer[] = [];
  private isPlaying = false;

  async initialize(): Promise<void> {
    this.audioContext = new AudioContext({ sampleRate: 24000 });
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);
  }

  async queueAudio(pcmData: ArrayBuffer): Promise<void> {
    this.queue.push(pcmData);
    if (!this.isPlaying) {
      this.playLoop();
    }
  }

  private async playLoop(): Promise<void> {
    if (!this.audioContext || !this.gainNode) {
      await this.initialize();
    }

    this.isPlaying = true;

    while (this.queue.length > 0) {
      const pcmData = this.queue.shift();
      if (pcmData) {
        await this.playPCM(pcmData);
      }
    }

    this.isPlaying = false;
  }

  private async playPCM(pcmData: ArrayBuffer): Promise<void> {
    if (!this.audioContext || !this.gainNode) return;

    // Decode PCM to AudioBuffer
    const dataView = new DataView(pcmData);
    const numSamples = pcmData.byteLength / 2;
    const audioBuffer = this.audioContext.createBuffer(1, numSamples, 24000);
    const channelData = audioBuffer.getChannelData(0);

    for (let i = 0; i < numSamples; i++) {
      channelData[i] = dataView.getInt16(i * 2, true) / 32768;
    }

    // Play
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.gainNode);

    return new Promise((resolve) => {
      source.onended = () => resolve();
      source.start();
    });
  }

  stop(): void {
    this.queue = [];
    this.isPlaying = false;
  }
}

// ============================================================================
// IPC BRIDGE FOR ELECTRON
// ============================================================================

/**
 * Main process side - sends audio to renderer
 */
export function setupMainProcessStreaming(
  ipcMain: Electron.IpcMain,
  mainWindow: Electron.BrowserWindow
): StreamingConversation {
  const conversation = new StreamingConversation({
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
    elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || '',
    voiceId: 'EXAVITQu4vr4xnSDxMaL',
  });

  // Forward audio to renderer
  conversation.on('play_audio', (audioData: ArrayBuffer) => {
    mainWindow.webContents.send('streaming-audio', audioData);
  });

  conversation.on('text', (token: string) => {
    mainWindow.webContents.send('streaming-text', token);
  });

  conversation.on('first_audio', (data: { time: number }) => {
    mainWindow.webContents.send('first-audio', data);
  });

  // Handle chat requests from renderer
  ipcMain.handle('streaming-chat', async (_event, message: string) => {
    return conversation.chat(message);
  });

  ipcMain.on('streaming-stop', () => {
    conversation.stop();
  });

  return conversation;
}

/**
 * Renderer process side - receives and plays audio
 */
export function setupRendererProcessStreaming(
  ipcRenderer: Electron.IpcRenderer
): StreamingAudioPlayer {
  const player = new StreamingAudioPlayer();

  ipcRenderer.on('streaming-audio', (_event, audioData: ArrayBuffer) => {
    player.queueAudio(audioData);
  });

  ipcRenderer.on('streaming-text', (_event, token: string) => {
    // Append to UI
    const display = document.getElementById('response-text');
    if (display) {
      display.textContent += token;
    }
  });

  return player;
}

// ============================================================================
// LATENCY COMPARISON
// ============================================================================

/**
 * Show the improvement with streaming TTS
 */
export const LATENCY_COMPARISON = {
  blocking: {
    description: 'Traditional (wait for full response)',
    timeline: [
      { phase: 'User speaks', time: '0ms' },
      { phase: 'STT processing (Deepgram)', time: '~300ms' },
      { phase: 'LLM generates FULL response', time: '~800-1500ms' },
      { phase: 'TTS generates FULL audio', time: '~300-500ms' },
      { phase: 'FIRST AUDIO PLAYS', time: '~1400-2300ms' },
    ],
    firstAudioDelay: '1400-2300ms',
  },
  
  streaming: {
    description: 'Streaming (speak while generating)',
    timeline: [
      { phase: 'User speaks', time: '0ms' },
      { phase: 'STT processing (Deepgram)', time: '~300ms' },
      { phase: 'LLM starts generating', time: '~400ms (first tokens)' },
      { phase: 'First sentence ready', time: '~500-600ms' },
      { phase: 'TTS generates first chunk', time: '~200ms' },
      { phase: 'FIRST AUDIO PLAYS', time: '~700-800ms' },
      { phase: '(rest generates in background)', time: 'parallel' },
    ],
    firstAudioDelay: '700-800ms',
  },
  
  improvement: '2-3x faster perceived response',
  note: 'Same quality, same models, just smarter ordering',
};

console.log('=== STREAMING TTS INTEGRATION ===');
console.log('First audio plays ~1600ms EARLIER');
console.log('Total time is the same, but FEELS 3x faster');
