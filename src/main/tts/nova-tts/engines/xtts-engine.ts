/**
 * Nova TTS - XTTS Engine
 * Voice cloning and multilingual TTS using Coqui XTTS v2
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
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
  VoiceCloneConfig,
  VoiceCloneResult,
} from '../types';
import { XTTS_VOICES } from '../voices';

const logger = createModuleLogger('NovaTTS-XTTS');

/**
 * XTTS engine configuration
 */
export interface XTTSEngineConfig {
  /** Path to Python executable */
  pythonPath: string;
  /** Path to store models */
  modelsPath: string;
  /** Path to store cloned voices */
  clonedVoicesPath: string;
  /** Path to XTTS scripts */
  scriptsPath: string;
  /** Default sample rate */
  sampleRate: number;
  /** GPU device ID (-1 for CPU) */
  gpuDeviceId: number;
  /** Enable DeepSpeed optimization */
  useDeepSpeed: boolean;
  /** Use lower precision for faster inference */
  useFp16: boolean;
}

/**
 * Get default XTTS paths
 */
function getDefaultPaths(): { pythonPath: string; modelsPath: string; clonedVoicesPath: string; scriptsPath: string } {
  const userDataPath = app?.getPath?.('userData') || 
    join(process.env.HOME || process.env.USERPROFILE || '.', '.nova-tts');
  
  return {
    pythonPath: 'python',
    modelsPath: join(userDataPath, 'models', 'xtts'),
    clonedVoicesPath: join(userDataPath, 'voices', 'cloned'),
    scriptsPath: join(userDataPath, 'scripts', 'xtts'),
  };
}

/**
 * Default XTTS configuration
 */
const DEFAULT_XTTS_CONFIG: XTTSEngineConfig = {
  ...getDefaultPaths(),
  sampleRate: 24000,
  gpuDeviceId: 0,
  useDeepSpeed: false,
  useFp16: true,
};

/**
 * XTTS Python inference script
 */
const XTTS_INFERENCE_SCRIPT = `
import sys
import json
import torch
import torchaudio
from TTS.tts.configs.xtts_config import XttsConfig
from TTS.tts.models.xtts import Xtts

def synthesize(model_path, text, speaker_wav, output_path, language="en"):
    config = XttsConfig()
    config.load_json(f"{model_path}/config.json")
    
    model = Xtts.init_from_config(config)
    model.load_checkpoint(config, checkpoint_dir=model_path, eval=True)
    model.cuda() if torch.cuda.is_available() else model.cpu()
    
    gpt_cond_latent, speaker_embedding = model.get_conditioning_latents(audio_path=speaker_wav)
    
    out = model.inference(
        text,
        language,
        gpt_cond_latent,
        speaker_embedding,
        temperature=0.7
    )
    
    torchaudio.save(output_path, torch.tensor(out["wav"]).unsqueeze(0), 24000)
    print(json.dumps({"success": True, "output": output_path}))

if __name__ == "__main__":
    args = json.loads(sys.argv[1])
    synthesize(
        args["model_path"],
        args["text"],
        args["speaker_wav"],
        args["output_path"],
        args.get("language", "en")
    )
`;

/**
 * XTTS TTS Engine
 * High-quality voice cloning and multilingual TTS
 */
export class XTTSEngine extends EventEmitter {
  readonly name: NovaTTSEngine = 'xtts';
  private config: XTTSEngineConfig;
  private _status: NovaTTSEngineStatus = NovaTTSEngineStatus.UNINITIALIZED;
  private availableVoices: NovaTTSVoice[] = [];
  private clonedVoices: Map<string, NovaTTSVoice> = new Map();
  private currentProcess: ChildProcess | null = null;
  private xttsAvailable = false;
  private gpuAvailable = false;

  constructor(config: Partial<XTTSEngineConfig> = {}) {
    super();
    const defaults = getDefaultPaths();
    this.config = {
      ...DEFAULT_XTTS_CONFIG,
      ...defaults,
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
      // Ensure directories exist
      mkdirSync(this.config.modelsPath, { recursive: true });
      mkdirSync(this.config.clonedVoicesPath, { recursive: true });
      mkdirSync(this.config.scriptsPath, { recursive: true });

      // Write inference script
      const scriptPath = join(this.config.scriptsPath, 'xtts_inference.py');
      writeFileSync(scriptPath, XTTS_INFERENCE_SCRIPT);

      // Check XTTS availability
      this.xttsAvailable = await this.checkXTTS();
      this.gpuAvailable = await this.checkGPU();

      if (!this.xttsAvailable) {
        logger.warn('XTTS not available. Install with: pip install TTS');
      }

      // Load voice catalog
      this.availableVoices = XTTS_VOICES;

      // Load cloned voices
      await this.loadClonedVoices();

      this.setStatus(NovaTTSEngineStatus.READY);
      logger.info('XTTS engine initialized', {
        xttsAvailable: this.xttsAvailable,
        gpuAvailable: this.gpuAvailable,
        clonedVoices: this.clonedVoices.size,
      });
    } catch (error) {
      this.setStatus(NovaTTSEngineStatus.ERROR);
      logger.error('Failed to initialize XTTS engine', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Check if XTTS is available
   */
  private async checkXTTS(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(this.config.pythonPath, ['-c', 'from TTS.tts.models.xtts import Xtts; print("ok")'], {
        timeout: 30000,
        shell: true,
      });

      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  /**
   * Check if GPU is available
   */
  private async checkGPU(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(this.config.pythonPath, ['-c', 'import torch; print(torch.cuda.is_available())'], {
        timeout: 10000,
        shell: true,
      });

      let stdout = '';
      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.on('close', (code) => {
        resolve(code === 0 && stdout.trim().toLowerCase() === 'true');
      });
      proc.on('error', () => resolve(false));
    });
  }

  /**
   * Load cloned voices from disk
   */
  private async loadClonedVoices(): Promise<void> {
    const metadataPath = join(this.config.clonedVoicesPath, 'metadata.json');
    if (existsSync(metadataPath)) {
      try {
        const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
        for (const voice of metadata.voices || []) {
          this.clonedVoices.set(voice.id, voice);
        }
      } catch (error) {
        logger.warn('Failed to load cloned voices metadata', { error: (error as Error).message });
      }
    }
  }

  /**
   * Save cloned voices metadata
   */
  private saveClonedVoicesMetadata(): void {
    const metadataPath = join(this.config.clonedVoicesPath, 'metadata.json');
    const metadata = {
      voices: Array.from(this.clonedVoices.values()),
    };
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
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
    logger.info('XTTS engine shutdown');
  }

  /**
   * Get available voices (including cloned)
   */
  getVoices(): NovaTTSVoice[] {
    return [...this.availableVoices, ...Array.from(this.clonedVoices.values())];
  }

  /**
   * Get a specific voice
   */
  getVoice(voiceId: string): NovaTTSVoice | null {
    return this.availableVoices.find(v => v.id === voiceId) || 
           this.clonedVoices.get(voiceId) || 
           null;
  }

  /**
   * Check if voice is downloaded
   */
  isVoiceDownloaded(voiceId: string): boolean {
    // Check if it's a cloned voice
    if (this.clonedVoices.has(voiceId)) {
      const voice = this.clonedVoices.get(voiceId)!;
      return voice.referenceAudio ? existsSync(voice.referenceAudio) : false;
    }
    
    // Check if base model is downloaded
    const modelPath = join(this.config.modelsPath, 'XTTS-v2');
    return existsSync(join(modelPath, 'config.json'));
  }

  /**
   * Download XTTS model
   */
  async downloadVoice(voiceId: string): Promise<void> {
    // For XTTS, we download the base model
    if (voiceId.startsWith('xtts')) {
      logger.info('Downloading XTTS v2 model...');
      
      // Use TTS library to download
      await this.runPython(`
from TTS.utils.manage import ModelManager
manager = ModelManager()
manager.download_model("tts_models/multilingual/multi-dataset/xtts_v2")
print("Download complete")
      `);

      logger.info('XTTS v2 model downloaded');
    }
  }

  /**
   * Delete a cloned voice
   */
  async deleteVoice(voiceId: string): Promise<void> {
    if (this.clonedVoices.has(voiceId)) {
      const voice = this.clonedVoices.get(voiceId)!;
      
      // Delete reference audio if it exists
      if (voice.referenceAudio && existsSync(voice.referenceAudio)) {
        unlinkSync(voice.referenceAudio);
      }

      // Delete speaker embedding if it exists
      const embeddingPath = join(this.config.clonedVoicesPath, `${voiceId}_embedding.pt`);
      if (existsSync(embeddingPath)) {
        unlinkSync(embeddingPath);
      }

      this.clonedVoices.delete(voiceId);
      this.saveClonedVoicesMetadata();
      logger.info('Cloned voice deleted', { voiceId });
    }
  }

  /**
   * Clone a voice from reference audio
   */
  async cloneVoice(config: VoiceCloneConfig): Promise<VoiceCloneResult> {
    const startTime = Date.now();
    const voiceId = `xtts-clone-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    this.emit('clone-progress', voiceId, 'starting', 0);

    try {
      if (!this.xttsAvailable) {
        throw new Error('XTTS not available');
      }

      if (!config.referenceAudioPaths || config.referenceAudioPaths.length === 0) {
        throw new Error('No reference audio provided');
      }

      // Verify reference audio exists
      const referenceAudio = config.referenceAudioPaths[0];
      if (!existsSync(referenceAudio)) {
        throw new Error(`Reference audio not found: ${referenceAudio}`);
      }

      this.emit('clone-progress', voiceId, 'processing_audio', 20);

      // Copy reference audio to cloned voices directory
      const destAudioPath = join(this.config.clonedVoicesPath, `${voiceId}_ref.wav`);
      const audioData = readFileSync(referenceAudio);
      writeFileSync(destAudioPath, audioData);

      this.emit('clone-progress', voiceId, 'extracting_embedding', 50);

      // Extract speaker embedding (if needed for fine-tuning)
      if (config.extractEmbedding) {
        await this.extractSpeakerEmbedding(destAudioPath, voiceId);
      }

      this.emit('clone-progress', voiceId, 'finalizing', 90);

      // Create voice entry
      const voice: NovaTTSVoice = {
        id: voiceId,
        name: config.name,
        description: config.description || `Cloned voice from ${basename(referenceAudio)}`,
        language: config.language,
        gender: 'neutral',
        age: 'adult',
        engine: 'xtts',
        quality: 'ultra',
        sampleRate: 24000,
        supportsEmotion: true,
        supportsStyle: true,
        isCloned: true,
        referenceAudio: destAudioPath,
        sizeInMB: Math.round(audioData.length / 1024 / 1024 * 10) / 10,
        tags: ['cloned', 'custom', config.language],
        createdAt: Date.now(),
      };

      this.clonedVoices.set(voiceId, voice);
      this.saveClonedVoicesMetadata();

      this.emit('clone-progress', voiceId, 'complete', 100);

      const result: VoiceCloneResult = {
        success: true,
        voice,
        qualityScore: 0.85, // Would be calculated from audio analysis
        timeTaken: Date.now() - startTime,
      };

      this.emit('clone-complete', result);
      logger.info('Voice cloned successfully', { voiceId, name: config.name });

      return result;
    } catch (error) {
      const result: VoiceCloneResult = {
        success: false,
        error: (error as Error).message,
        timeTaken: Date.now() - startTime,
      };

      this.emit('clone-complete', result);
      logger.error('Voice cloning failed', { error: (error as Error).message });

      return result;
    }
  }

  /**
   * Extract speaker embedding from audio
   */
  private async extractSpeakerEmbedding(audioPath: string, voiceId: string): Promise<void> {
    const embeddingPath = join(this.config.clonedVoicesPath, `${voiceId}_embedding.pt`);
    
    await this.runPython(`
import torch
import torchaudio
from TTS.tts.configs.xtts_config import XttsConfig
from TTS.tts.models.xtts import Xtts

# Load model
config = XttsConfig()
model_path = "${this.config.modelsPath}/XTTS-v2"
config.load_json(f"{model_path}/config.json")
model = Xtts.init_from_config(config)
model.load_checkpoint(config, checkpoint_dir=model_path, eval=True)

# Extract embedding
gpt_cond_latent, speaker_embedding = model.get_conditioning_latents(audio_path="${audioPath}")

# Save embedding
torch.save({
    'gpt_cond_latent': gpt_cond_latent,
    'speaker_embedding': speaker_embedding
}, "${embeddingPath}")
print("Embedding extracted")
    `);
  }

  /**
   * Run Python code
   */
  private runPython(code: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.config.pythonPath, ['-c', code], {
        shell: true,
        env: {
          ...process.env,
          CUDA_VISIBLE_DEVICES: this.config.gpuDeviceId >= 0 ? String(this.config.gpuDeviceId) : '',
        },
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
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Python process exited with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Synthesize text to speech
   */
  async synthesize(text: string, options: SynthesisOptions): Promise<NovaTTSSynthesisResult> {
    if (this._status !== NovaTTSEngineStatus.READY) {
      throw new Error('XTTS engine not ready');
    }

    if (!this.xttsAvailable) {
      throw new Error('XTTS not available');
    }

    const voice = this.getVoice(options.voiceId);
    if (!voice) {
      throw new Error(`Voice not found: ${options.voiceId}`);
    }

    // Need reference audio for XTTS
    const referenceAudio = voice.referenceAudio;
    if (!referenceAudio || !existsSync(referenceAudio)) {
      throw new Error('Reference audio required for XTTS synthesis');
    }

    const startTime = Date.now();
    const id = `xtts_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const outputPath = join(this.config.clonedVoicesPath, `${id}_output.wav`);

    this.setStatus(NovaTTSEngineStatus.BUSY);
    this.emit('synthesis-start', id, text, options);

    try {
      // Determine language
      const language = voice.language.split('-')[0] || 'en';

      // Run XTTS synthesis
      await this.runPython(`
import torch
import torchaudio
from TTS.tts.configs.xtts_config import XttsConfig
from TTS.tts.models.xtts import Xtts

# Load model
config = XttsConfig()
model_path = "${this.config.modelsPath}/XTTS-v2"
config.load_json(f"{model_path}/config.json")
model = Xtts.init_from_config(config)
model.load_checkpoint(config, checkpoint_dir=model_path, eval=True)
${this.gpuAvailable ? 'model.cuda()' : ''}

# Get speaker conditioning
gpt_cond_latent, speaker_embedding = model.get_conditioning_latents(audio_path="${referenceAudio}")

# Synthesize
out = model.inference(
    "${text.replace(/"/g, '\\"')}",
    "${language}",
    gpt_cond_latent,
    speaker_embedding,
    temperature=0.7
)

# Save output
torchaudio.save("${outputPath}", torch.tensor(out["wav"]).unsqueeze(0), 24000)
print("Synthesis complete")
      `);

      // Read the generated audio
      const audioData = readFileSync(outputPath);

      // Clean up temp file
      try { unlinkSync(outputPath); } catch { /* Ignore cleanup errors */ }

      const processingTimeMs = Date.now() - startTime;
      const durationMs = (audioData.length / 2 / this.config.sampleRate) * 1000;
      const rtf = processingTimeMs / durationMs;

      const result: NovaTTSSynthesisResult = {
        id,
        audio: audioData,
        format: {
          type: 'wav',
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
   * Synthesize text with streaming
   */
  async *synthesizeStream(text: string, options: SynthesisOptions): AsyncGenerator<NovaTTSAudioChunk> {
    // XTTS doesn't support true streaming, synthesize and chunk
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
        format: 'wav',
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
      name: 'XTTS v2 (Coqui)',
      description: 'High-quality voice cloning and multilingual TTS',
      available: this.xttsAvailable,
      status: this._status,
      supportsStreaming: false,
      supportsCloning: true,
      supportsEmotion: true,
      supportsStyle: true,
      supportedLanguages: [
        'en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'tr', 'ru',
        'nl', 'cs', 'ar', 'zh', 'ja', 'ko', 'hu',
      ],
      requiresGpu: true,
      gpuMemoryMB: this.gpuAvailable ? 4000 : undefined,
      averageLatencyMs: this.gpuAvailable ? 1500 : 8000,
      averageRtf: this.gpuAvailable ? 0.5 : 3.0,
    };
  }
}

export default XTTSEngine;
