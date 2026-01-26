/**
 * Nova TTS - Edge TTS Engine
 * Free Microsoft Edge TTS API (no API key required)
 * High-quality neural voices with emotion and style support
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../../../utils/logger';
import {
  NovaTTSEngine,
  NovaTTSVoice,
  NovaTTSEngineStatus,
  SynthesisOptions,
  NovaTTSAudioChunk,
  NovaTTSSynthesisResult,
  EngineInfo,
  VoiceEmotion,
  SpeakingStyle,
} from '../types';
import { EDGE_VOICES } from '../voices';

const logger = createModuleLogger('NovaTTS-Edge');

/**
 * Edge TTS voice mapping (voice ID to edge-tts voice name)
 */
const EDGE_VOICE_MAP: Record<string, string> = {
  'edge-en-us-jenny': 'en-US-JennyNeural',
  'edge-en-us-guy': 'en-US-GuyNeural',
  'edge-en-us-aria': 'en-US-AriaNeural',
  'edge-en-gb-ryan': 'en-GB-RyanNeural',
  'edge-en-gb-sonia': 'en-GB-SoniaNeural',
  'edge-en-au-natasha': 'en-AU-NatashaNeural',
  'edge-en-au-william': 'en-AU-WilliamNeural',
  'edge-en-in-neerja': 'en-IN-NeerjaNeural',
  'edge-de-de-katja': 'de-DE-KatjaNeural',
  'edge-de-de-conrad': 'de-DE-ConradNeural',
  'edge-es-es-elvira': 'es-ES-ElviraNeural',
  'edge-es-mx-dalia': 'es-MX-DaliaNeural',
  'edge-fr-fr-denise': 'fr-FR-DeniseNeural',
  'edge-fr-fr-henri': 'fr-FR-HenriNeural',
  'edge-it-it-elsa': 'it-IT-ElsaNeural',
  'edge-ja-jp-nanami': 'ja-JP-NanamiNeural',
  'edge-ko-kr-sun-hi': 'ko-KR-SunHiNeural',
  'edge-pt-br-francisca': 'pt-BR-FranciscaNeural',
  'edge-zh-cn-xiaoxiao': 'zh-CN-XiaoxiaoNeural',
  'edge-zh-cn-yunyang': 'zh-CN-YunyangNeural',
};

/**
 * Edge TTS style mappings
 */
const EDGE_STYLE_MAP: Record<SpeakingStyle, string> = {
  'conversational': 'chat',
  'newscast': 'newscast',
  'narration': 'narration-professional',
  'assistant': 'assistant',
  'customer-service': 'customerservice',
  'whispering': 'whispering',
  'shouting': 'shouting',
  'singing': 'lyrical',
  'poetry': 'poetry-reading',
  'storytelling': 'narration-relaxed',
  'documentary': 'documentary-narration',
  'advertisement': 'advertisement-upbeat',
};

/**
 * Edge TTS emotion mappings
 */
const EDGE_EMOTION_MAP: Record<VoiceEmotion, { style?: string; styledegree?: string }> = {
  'neutral': {},
  'happy': { style: 'cheerful', styledegree: '1.5' },
  'sad': { style: 'sad', styledegree: '1.5' },
  'angry': { style: 'angry', styledegree: '1.5' },
  'fearful': { style: 'terrified', styledegree: '1.0' },
  'surprised': { style: 'excited', styledegree: '1.5' },
  'disgusted': { style: 'disgruntled', styledegree: '1.0' },
  'excited': { style: 'excited', styledegree: '2.0' },
  'calm': { style: 'calm', styledegree: '1.0' },
  'serious': { style: 'serious', styledegree: '1.5' },
  'playful': { style: 'cheerful', styledegree: '1.2' },
  'professional': { style: 'newscast', styledegree: '1.0' },
  'warm': { style: 'friendly', styledegree: '1.5' },
  'cold': { style: 'unfriendly', styledegree: '1.0' },
};

/**
 * Edge TTS engine configuration
 */
export interface EdgeEngineConfig {
  /** Path to edge-tts CLI or Python module */
  edgeTtsPath?: string;
  /** Path to Python executable */
  pythonPath: string;
  /** Cache directory for audio files */
  cachePath: string;
  /** Default sample rate */
  sampleRate: number;
  /** Use SSML for advanced features */
  useSsml: boolean;
}

/**
 * Get default Edge TTS paths
 */
function getDefaultPaths(): { pythonPath: string; cachePath: string } {
  const userDataPath = app?.getPath?.('userData') || 
    join(process.env.HOME || process.env.USERPROFILE || '.', '.nova-tts');
  
  return {
    pythonPath: 'python', // Assume python is in PATH
    cachePath: join(userDataPath, 'cache', 'edge-tts'),
  };
}

/**
 * Default Edge TTS configuration
 */
const DEFAULT_EDGE_CONFIG: EdgeEngineConfig = {
  ...getDefaultPaths(),
  sampleRate: 24000,
  useSsml: true,
};

/**
 * Edge TTS Engine
 * Free high-quality neural TTS using Microsoft Edge's API
 */
export class EdgeEngine extends EventEmitter {
  readonly name: NovaTTSEngine = 'edge';
  private config: EdgeEngineConfig;
  private _status: NovaTTSEngineStatus = NovaTTSEngineStatus.UNINITIALIZED;
  private availableVoices: NovaTTSVoice[] = [];
  private currentProcess: ChildProcess | null = null;
  private edgeTtsAvailable = false;

  constructor(config: Partial<EdgeEngineConfig> = {}) {
    super();
    const defaults = getDefaultPaths();
    this.config = {
      ...DEFAULT_EDGE_CONFIG,
      pythonPath: defaults.pythonPath,
      cachePath: defaults.cachePath,
      ...config,
    };
  }

  /**
   * Get current status
   */
  get status(): NovaTTSEngineStatus {
    return this._status;
  }

  /**
   * Set status and emit event
   */
  private setStatus(status: NovaTTSEngineStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.emit('engine-status', this.name, status);
    }
  }

  /**
   * Initialize the engine
   */
  async initialize(): Promise<void> {
    this.setStatus(NovaTTSEngineStatus.LOADING);

    try {
      // Ensure cache directory exists
      if (!existsSync(this.config.cachePath)) {
        mkdirSync(this.config.cachePath, { recursive: true });
      }

      // Check if edge-tts Python package is available
      this.edgeTtsAvailable = await this.checkEdgeTts();
      
      if (!this.edgeTtsAvailable) {
        logger.warn('edge-tts Python package not found. Install with: pip install edge-tts');
      }

      // Load voice catalog
      this.availableVoices = EDGE_VOICES;

      this.setStatus(NovaTTSEngineStatus.READY);
      logger.info('Edge TTS engine initialized', {
        edgeTtsAvailable: this.edgeTtsAvailable,
        voiceCount: this.availableVoices.length,
      });
    } catch (error) {
      this.setStatus(NovaTTSEngineStatus.ERROR);
      logger.error('Failed to initialize Edge TTS engine', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Check if edge-tts is available
   */
  private async checkEdgeTts(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(this.config.pythonPath, ['-m', 'edge_tts', '--version'], {
        timeout: 5000,
        shell: true,
      });

      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  /**
   * Shutdown the engine
   */
  async shutdown(): Promise<void> {
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
    }
    this.setStatus(NovaTTSEngineStatus.SHUTDOWN);
    logger.info('Edge TTS engine shutdown');
  }

  /**
   * Get available voices
   */
  getVoices(): NovaTTSVoice[] {
    return this.availableVoices;
  }

  /**
   * Get a specific voice
   */
  getVoice(voiceId: string): NovaTTSVoice | null {
    return this.availableVoices.find(v => v.id === voiceId) || null;
  }

  /**
   * Edge voices are cloud-based, always "downloaded"
   */
  isVoiceDownloaded(_voiceId: string): boolean {
    return true;
  }

  /**
   * No download needed for Edge voices
   */
  async downloadVoice(_voiceId: string): Promise<void> {
    // No-op - Edge voices are cloud-based
  }

  /**
   * Cannot delete Edge voices
   */
  async deleteVoice(_voiceId: string): Promise<void> {
    // No-op - Edge voices are cloud-based
  }

  /**
   * Build SSML for synthesis with emotion/style
   */
  private buildSsml(text: string, voice: string, options: SynthesisOptions): string {
    const emotion = options.emotion ? EDGE_EMOTION_MAP[options.emotion] : {};
    const style = options.style ? EDGE_STYLE_MAP[options.style] : undefined;

    // Calculate rate and pitch
    const rate = options.characteristics?.speakingRate 
      ? `${Math.round((options.characteristics.speakingRate / 150 - 1) * 100)}%`
      : '0%';
    const pitch = options.characteristics?.pitchHz
      ? `${options.characteristics.pitchHz - 200}Hz`
      : '0%';

    // Build express-as tag if we have style/emotion
    let expressAs = '';
    if (emotion.style || style) {
      const styleAttr = emotion.style || style || '';
      const degreeAttr = emotion.styledegree ? ` styledegree="${emotion.styledegree}"` : '';
      expressAs = `<mstts:express-as style="${styleAttr}"${degreeAttr}>`;
    }

    const ssml = `
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
       xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
  <voice name="${voice}">
    ${expressAs}
    <prosody rate="${rate}" pitch="${pitch}">
      ${this.escapeXml(text)}
    </prosody>
    ${expressAs ? '</mstts:express-as>' : ''}
  </voice>
</speak>`.trim();

    return ssml;
  }

  /**
   * Escape XML special characters
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Synthesize text to speech
   */
  async synthesize(text: string, options: SynthesisOptions): Promise<NovaTTSSynthesisResult> {
    if (this._status !== NovaTTSEngineStatus.READY) {
      throw new Error('Edge TTS engine not ready');
    }

    if (!this.edgeTtsAvailable) {
      throw new Error('edge-tts Python package not installed');
    }

    const voice = this.getVoice(options.voiceId);
    if (!voice) {
      throw new Error(`Voice not found: ${options.voiceId}`);
    }

    const edgeVoice = EDGE_VOICE_MAP[options.voiceId];
    if (!edgeVoice) {
      throw new Error(`No Edge voice mapping for: ${options.voiceId}`);
    }

    const startTime = Date.now();
    const id = `edge_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    this.setStatus(NovaTTSEngineStatus.BUSY);
    this.emit('synthesis-start', id, text, options);

    try {
      // Generate output path
      const outputPath = join(this.config.cachePath, `${id}.mp3`);

      // Run edge-tts
      await this.runEdgeTts(text, edgeVoice, outputPath, options);

      // Read the generated audio
      const audioData = readFileSync(outputPath);

      // Clean up temp file
      try { unlinkSync(outputPath); } catch { /* Ignore cleanup errors */ }

      const processingTimeMs = Date.now() - startTime;
      // Estimate duration from file size (MP3 at ~128kbps)
      const durationMs = (audioData.length / 16000) * 1000;
      const rtf = processingTimeMs / durationMs;

      const result: NovaTTSSynthesisResult = {
        id,
        audio: audioData,
        format: {
          type: 'mp3',
          sampleRate: this.config.sampleRate,
          channels: 1,
          bitDepth: 16,
        },
        durationMs,
        characterCount: text.length,
        wordCount: text.split(/\s+/).length,
        latencyMs: processingTimeMs,
        processingTimeMs,
        rtf,
        voiceId: options.voiceId,
        engine: this.name,
        emotion: options.emotion,
        style: options.style,
      };

      this.emit('synthesis-complete', result);
      this.setStatus(NovaTTSEngineStatus.READY);

      return result;
    } catch (error) {
      this.emit('synthesis-error', id, error as Error);
      this.setStatus(NovaTTSEngineStatus.READY);
      throw error;
    }
  }

  /**
   * Run edge-tts command
   */
  private runEdgeTts(
    text: string, 
    voice: string, 
    outputPath: string,
    options: SynthesisOptions
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Build command arguments
      const args = ['-m', 'edge_tts'];

      // Use SSML if enabled and we have emotion/style
      if (this.config.useSsml && (options.emotion || options.style)) {
        const ssml = this.buildSsml(text, voice, options);
        args.push('--text', ssml);
        args.push('--voice', voice);
      } else {
        args.push('--text', text);
        args.push('--voice', voice);

        // Add rate if specified
        if (options.characteristics?.speakingRate) {
          const rate = Math.round((options.characteristics.speakingRate / 150 - 1) * 100);
          args.push('--rate', `${rate >= 0 ? '+' : ''}${rate}%`);
        }

        // Add pitch if specified
        if (options.characteristics?.pitchHz) {
          const pitch = Math.round(options.characteristics.pitchHz - 200);
          args.push('--pitch', `${pitch >= 0 ? '+' : ''}${pitch}Hz`);
        }
      }

      args.push('--write-media', outputPath);

      logger.debug('Running edge-tts', { voice, outputPath });

      const proc = spawn(this.config.pythonPath, args, {
        shell: true,
        timeout: 30000,
      });

      this.currentProcess = proc;

      let stderr = '';
      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        this.currentProcess = null;
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`edge-tts failed: ${stderr || `exit code ${code}`}`));
        }
      });

      proc.on('error', (error) => {
        this.currentProcess = null;
        reject(error);
      });
    });
  }

  /**
   * Synthesize text with streaming
   */
  async *synthesizeStream(text: string, options: SynthesisOptions): AsyncGenerator<NovaTTSAudioChunk> {
    // Edge TTS doesn't support true streaming, so we synthesize and chunk
    const result = await this.synthesize(text, options);
    
    const chunkSize = options.streamChunkSize || 8192;
    const numChunks = Math.ceil(result.audio.length / chunkSize);
    const chunkDuration = result.durationMs / numChunks;

    for (let i = 0; i < numChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, result.audio.length);
      const chunkData = result.audio.subarray(start, end);

      const chunk: NovaTTSAudioChunk = {
        id: `${result.id}_chunk_${i}`,
        sequence: i,
        data: Buffer.from(chunkData),
        format: 'mp3',
        sampleRate: this.config.sampleRate,
        durationMs: chunkDuration,
        text: i === 0 ? text : '',
        isFinal: i === numChunks - 1,
        timestamp: Date.now(),
      };

      this.emit('audio-chunk', chunk);
      yield chunk;
    }
  }

  /**
   * Stop current synthesis
   */
  stop(): void {
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
    }
  }

  /**
   * Get engine information
   */
  getEngineInfo(): EngineInfo {
    return {
      engine: this.name,
      name: 'Microsoft Edge TTS',
      description: 'Free high-quality neural TTS via Microsoft Edge API',
      available: this.edgeTtsAvailable,
      status: this._status,
      supportsStreaming: false, // Simulated streaming
      supportsCloning: false,
      supportsEmotion: true,
      supportsStyle: true,
      supportedLanguages: [
        'en-US', 'en-GB', 'en-AU', 'en-IN',
        'de-DE', 'es-ES', 'es-MX', 'fr-FR', 'it-IT',
        'ja-JP', 'ko-KR', 'pt-BR', 'zh-CN', 'zh-TW',
        'ar-SA', 'ru-RU', 'pl-PL', 'nl-NL', 'sv-SE',
      ],
      requiresGpu: false,
      averageLatencyMs: 800, // Network latency
      averageRtf: 0.3, // Depends on network
    };
  }

  /**
   * Fetch all available Edge voices from the API
   */
  async fetchAvailableVoices(): Promise<NovaTTSVoice[]> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.config.pythonPath, ['-m', 'edge_tts', '--list-voices'], {
        shell: true,
        timeout: 10000,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // Parse the voice list output
          const voices: NovaTTSVoice[] = [];
          const lines = stdout.split('\n');
          
          for (const line of lines) {
            const match = line.match(/Name: (.+)/);
            if (match) {
              const name = match[1].trim();
              const gender = line.includes('Female') ? 'female' : line.includes('Male') ? 'male' : 'neutral';
              const langMatch = line.match(/([a-z]{2}-[A-Z]{2})/);
              const language = langMatch ? langMatch[1] : 'en-US';

              voices.push({
                id: `edge-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
                name: name.replace('Neural', '').trim(),
                language,
                gender: gender as 'male' | 'female' | 'neutral',
                age: 'adult',
                engine: 'edge',
                quality: 'high',
                sampleRate: 24000,
                supportsEmotion: true,
                supportsStyle: true,
                isCloned: false,
                sizeInMB: 0,
                tags: ['microsoft', 'neural', 'free'],
                createdAt: Date.now(),
              });
            }
          }

          resolve(voices);
        } else {
          reject(new Error(`Failed to list voices: ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }
}

export default EdgeEngine;
