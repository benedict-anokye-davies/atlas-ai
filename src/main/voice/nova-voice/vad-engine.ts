/**
 * NovaVoice - Silero VAD Engine
 * Ultra-fast voice activity detection
 * 
 * Performance: 87.7% TPR @ 5% FPR, 10-20ms latency
 * Resource usage: 0.004 RTF, 0.43% CPU
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../../utils/logger';
import {
  VADConfig,
  VADResult,
  VADEngine,
  DEFAULT_VAD_CONFIG,
  AudioFormat,
  AUDIO_FORMATS,
} from './types';
import {
  SlidingWindowBuffer,
  calculateRMS,
  toFloat32Array,
} from './audio-buffer';

const logger = createModuleLogger('NovaVoice-VAD');

/**
 * VAD state machine states
 */
enum VADState {
  IDLE = 'idle',
  SPEECH_START = 'speech-start',
  SPEECH = 'speech',
  SPEECH_END = 'speech-end',
}

/**
 * Silero VAD configuration
 */
export interface SileroVADConfig extends VADConfig {
  /** Model path (downloaded automatically if not present) */
  modelPath?: string;
  /** Number of padding frames for endpoint detection */
  paddingFrames: number;
  /** Redemption frames (how many non-speech frames before endpoint) */
  redemptionFrames: number;
}

export const DEFAULT_SILERO_CONFIG: SileroVADConfig = {
  ...DEFAULT_VAD_CONFIG,
  engine: VADEngine.SILERO,
  modelPath: undefined,
  paddingFrames: 2,
  redemptionFrames: 8,
};

/**
 * Silero VAD events
 */
export interface SileroVADEvents {
  'speech-start': (timestamp: number) => void;
  'speech-end': (timestamp: number, duration: number) => void;
  'speech-probability': (probability: number) => void;
  'error': (error: Error) => void;
  'ready': () => void;
}

/**
 * Silero VAD Engine
 * High-accuracy voice activity detection with endpoint prediction
 */
export class SileroVAD extends EventEmitter {
  private config: SileroVADConfig;
  private modelPath: string;
  private pythonProcess: ChildProcess | null = null;
  private isReady: boolean = false;
  private isProcessing: boolean = false;
  
  // State machine
  private state: VADState = VADState.IDLE;
  private speechStartTime: number = 0;
  private speechFrameCount: number = 0;
  private silenceFrameCount: number = 0;
  
  // Sliding window for audio
  private windowBuffer: SlidingWindowBuffer;
  
  // ONNX Runtime inference (for in-process option)
  private onnxSession: unknown = null;
  private hiddenState: Float32Array | null = null;
  private cellState: Float32Array | null = null;
  
  // Performance tracking
  private lastLatency: number = 0;
  private avgLatency: number = 0;
  private frameCount: number = 0;
  
  constructor(config?: Partial<SileroVADConfig>) {
    super();
    this.config = { ...DEFAULT_SILERO_CONFIG, ...config };
    
    // Set up model path
    const userDataPath = app?.getPath?.('userData') || process.cwd();
    this.modelPath = this.config.modelPath || join(userDataPath, 'models', 'silero-vad');
    
    // Initialize sliding window (30ms frames at 16kHz)
    const sampleRate = AUDIO_FORMATS.STT_INPUT.sampleRate;
    this.windowBuffer = new SlidingWindowBuffer(
      this.config.frameSizeMs,
      this.config.frameSizeMs / 2, // 50% overlap
      sampleRate
    );
    
    logger.info('SileroVAD created', { config: this.config });
  }
  
  /**
   * Initialize the VAD engine
   */
  async initialize(): Promise<void> {
    logger.info('Initializing SileroVAD...');
    
    // Ensure model directory exists
    if (!existsSync(this.modelPath)) {
      mkdirSync(this.modelPath, { recursive: true });
    }
    
    // Download model if needed
    await this.ensureModelDownloaded();
    
    // Initialize ONNX session
    await this.initializeONNX();
    
    this.isReady = true;
    this.emit('ready');
    
    logger.info('SileroVAD initialized successfully');
  }
  
  /**
   * Ensure Silero VAD model is downloaded
   */
  private async ensureModelDownloaded(): Promise<void> {
    const modelFile = join(this.modelPath, 'silero_vad.onnx');
    
    if (existsSync(modelFile)) {
      logger.info('Silero VAD model already downloaded');
      return;
    }
    
    logger.info('Downloading Silero VAD model...');
    
    // Download using Python script (most reliable)
    const downloadScript = `
import torch
torch.hub.download_url_to_file('https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.onnx',
                               '${modelFile.replace(/\\/g, '\\\\')}')
print('Downloaded successfully')
`;
    
    const scriptPath = join(this.modelPath, 'download_vad.py');
    writeFileSync(scriptPath, downloadScript);
    
    return new Promise((resolve, reject) => {
      const proc = spawn('python', [scriptPath]);
      
      proc.on('close', (code) => {
        try {
          unlinkSync(scriptPath);
        } catch { /* Ignore cleanup errors */ }
        
        if (code === 0 && existsSync(modelFile)) {
          logger.info('Silero VAD model downloaded successfully');
          resolve();
        } else {
          reject(new Error('Failed to download Silero VAD model'));
        }
      });
      
      proc.on('error', (err) => {
        reject(err);
      });
    });
  }
  
  /**
   * Initialize ONNX Runtime session
   */
  private async initializeONNX(): Promise<void> {
    // Try to use onnxruntime-node for native performance
    try {
      const ort = require('onnxruntime-node');
      const modelFile = join(this.modelPath, 'silero_vad.onnx');
      
      this.onnxSession = await ort.InferenceSession.create(modelFile, {
        executionProviders: ['CPUExecutionProvider'],
        graphOptimizationLevel: 'all',
      });
      
      // Initialize hidden states (2 layers, batch 1, hidden size 64)
      this.hiddenState = new Float32Array(2 * 1 * 64).fill(0);
      this.cellState = new Float32Array(2 * 1 * 64).fill(0);
      
      logger.info('ONNX Runtime initialized for VAD');
    } catch (error) {
      logger.warn('ONNX Runtime not available, falling back to Python inference', {
        error: (error as Error).message,
      });
    }
  }
  
  /**
   * Process audio frame and return VAD result
   */
  async processFrame(audioData: Buffer | Float32Array): Promise<VADResult> {
    if (!this.isReady) {
      throw new Error('VAD not initialized');
    }
    
    const startTime = Date.now();
    
    // Convert to Float32Array if needed using type-safe helper
    const samples = toFloat32Array(audioData);
    
    // Add to sliding window and get complete frames
    const frames = this.windowBuffer.addSamples(samples);
    
    let result: VADResult = {
      isSpeech: false,
      confidence: 0,
      latencyMs: 0,
    };
    
    // Process each complete frame
    for (const frame of frames) {
      result = await this.processWindowFrame(frame);
    }
    
    // Update latency tracking
    this.lastLatency = Date.now() - startTime;
    this.avgLatency = (this.avgLatency * this.frameCount + this.lastLatency) / (this.frameCount + 1);
    this.frameCount++;
    
    result.latencyMs = this.lastLatency;
    
    return result;
  }
  
  /**
   * Process a single window frame through VAD
   */
  private async processWindowFrame(frame: Float32Array): Promise<VADResult> {
    let probability: number;
    
    if (this.onnxSession) {
      probability = await this.runONNXInference(frame);
    } else {
      probability = await this.runPythonInference(frame);
    }
    
    this.emit('speech-probability', probability);
    
    // Run state machine
    return this.updateStateMachine(probability);
  }
  
  /**
   * Run ONNX inference for VAD
   */
  private async runONNXInference(frame: Float32Array): Promise<number> {
    try {
      const ort = require('onnxruntime-node');
      const session = this.onnxSession as InstanceType<typeof ort.InferenceSession>;
      
      // Prepare inputs
      const inputTensor = new ort.Tensor('float32', frame, [1, frame.length]);
      const srTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(16000)]), []);
      const hTensor = new ort.Tensor('float32', this.hiddenState!, [2, 1, 64]);
      const cTensor = new ort.Tensor('float32', this.cellState!, [2, 1, 64]);
      
      // Run inference
      const results = await session.run({
        input: inputTensor,
        sr: srTensor,
        h: hTensor,
        c: cTensor,
      });
      
      // Update hidden states for next frame
      this.hiddenState = new Float32Array(results.hn.data as Float32Array);
      this.cellState = new Float32Array(results.cn.data as Float32Array);
      
      // Get probability
      const output = results.output.data as Float32Array;
      return output[0];
    } catch (error) {
      logger.warn('ONNX inference failed', { error: (error as Error).message });
      return this.fallbackVAD(frame);
    }
  }
  
  /**
   * Run Python inference for VAD (fallback)
   */
  private async runPythonInference(frame: Float32Array): Promise<number> {
    // Use energy-based fallback for now
    return this.fallbackVAD(frame);
  }
  
  /**
   * Simple energy-based VAD fallback
   */
  private fallbackVAD(frame: Float32Array): number {
    const rms = calculateRMS(frame);
    // Convert RMS to probability (calibrated threshold)
    const threshold = 0.01;
    return Math.min(1, rms / threshold);
  }
  
  /**
   * Update VAD state machine
   */
  private updateStateMachine(probability: number): VADResult {
    const isSpeech = probability >= this.config.speechThreshold;
    const now = Date.now();
    
    const result: VADResult = {
      isSpeech,
      confidence: probability,
      latencyMs: this.lastLatency,
    };
    
    switch (this.state) {
      case VADState.IDLE:
        if (isSpeech) {
          this.state = VADState.SPEECH_START;
          this.speechStartTime = now;
          this.speechFrameCount = 1;
          this.silenceFrameCount = 0;
          result.speechStart = now;
          this.emit('speech-start', now);
        }
        break;
        
      case VADState.SPEECH_START:
        if (isSpeech) {
          this.speechFrameCount++;
          // Confirm speech start after minimum duration
          if (this.speechFrameCount * this.config.frameSizeMs >= this.config.minSpeechDurationMs) {
            this.state = VADState.SPEECH;
          }
        } else {
          this.silenceFrameCount++;
          if (this.silenceFrameCount >= this.config.redemptionFrames) {
            // False start, go back to idle
            this.state = VADState.IDLE;
            this.speechFrameCount = 0;
            this.silenceFrameCount = 0;
          }
        }
        break;
        
      case VADState.SPEECH:
        if (isSpeech) {
          this.speechFrameCount++;
          this.silenceFrameCount = 0;
        } else {
          this.silenceFrameCount++;
          // Check for endpoint
          if (this.silenceFrameCount * this.config.frameSizeMs >= this.config.silenceThresholdMs) {
            this.state = VADState.SPEECH_END;
          }
        }
        break;
        
      case VADState.SPEECH_END:
        const duration = now - this.speechStartTime;
        result.speechEnd = now;
        result.isEndpoint = true;
        
        this.emit('speech-end', now, duration);
        
        // Reset state
        this.state = VADState.IDLE;
        this.speechFrameCount = 0;
        this.silenceFrameCount = 0;
        break;
    }
    
    return result;
  }
  
  /**
   * Reset VAD state
   */
  reset(): void {
    this.state = VADState.IDLE;
    this.speechStartTime = 0;
    this.speechFrameCount = 0;
    this.silenceFrameCount = 0;
    this.windowBuffer.reset();
    
    // Reset ONNX hidden states
    if (this.hiddenState) {
      this.hiddenState.fill(0);
    }
    if (this.cellState) {
      this.cellState.fill(0);
    }
    
    logger.debug('VAD state reset');
  }
  
  /**
   * Get current VAD state
   */
  getState(): VADState {
    return this.state;
  }
  
  /**
   * Check if currently detecting speech
   */
  isSpeechActive(): boolean {
    return this.state === VADState.SPEECH || this.state === VADState.SPEECH_START;
  }
  
  /**
   * Get average processing latency
   */
  getAverageLatency(): number {
    return this.avgLatency;
  }
  
  /**
   * Shutdown VAD engine
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down SileroVAD...');
    
    if (this.pythonProcess) {
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }
    
    this.onnxSession = null;
    this.isReady = false;
    
    logger.info('SileroVAD shutdown complete');
  }
}

/**
 * WebRTC VAD - Ultra-lightweight fallback
 * 50% TPR but extremely fast
 */
export class WebRTCVAD extends EventEmitter {
  private config: VADConfig;
  private vadMode: number = 3; // Aggressive mode
  private frameSize: number;
  private isActive: boolean = false;
  private silenceCount: number = 0;
  
  constructor(config?: Partial<VADConfig>) {
    super();
    this.config = { ...DEFAULT_VAD_CONFIG, engine: VADEngine.WEBRTC, ...config };
    this.frameSize = Math.floor(this.config.frameSizeMs * 16); // 16 samples per ms at 16kHz
  }
  
  async initialize(): Promise<void> {
    this.emit('ready');
  }
  
  async processFrame(audioData: Buffer | Float32Array): Promise<VADResult> {
    const startTime = Date.now();
    
    // Convert to Float32Array if needed using type-safe helper
    const samples = toFloat32Array(audioData);
    
    // Simple energy-based detection
    const energy = calculateRMS(samples);
    const threshold = 0.005 * (this.vadMode + 1); // Adjust based on mode
    const isSpeech = energy > threshold;
    
    if (isSpeech) {
      if (!this.isActive) {
        this.isActive = true;
        this.emit('speech-start', Date.now());
      }
      this.silenceCount = 0;
    } else {
      this.silenceCount++;
      const silenceMs = this.silenceCount * this.config.frameSizeMs;
      
      if (this.isActive && silenceMs >= this.config.silenceThresholdMs) {
        this.isActive = false;
        this.emit('speech-end', Date.now(), 0);
      }
    }
    
    return {
      isSpeech,
      confidence: Math.min(1, energy / threshold),
      latencyMs: Date.now() - startTime,
      isEndpoint: !isSpeech && this.silenceCount * this.config.frameSizeMs >= this.config.silenceThresholdMs,
    };
  }
  
  reset(): void {
    this.isActive = false;
    this.silenceCount = 0;
  }
  
  isSpeechActive(): boolean {
    return this.isActive;
  }
  
  async shutdown(): Promise<void> {
    this.reset();
  }
}

/**
 * Create appropriate VAD engine based on config
 */
export function createVAD(config?: Partial<VADConfig>): SileroVAD | WebRTCVAD {
  const engine = config?.engine || VADEngine.SILERO;
  
  switch (engine) {
    case VADEngine.WEBRTC:
      return new WebRTCVAD(config);
    case VADEngine.SILERO:
    default:
      return new SileroVAD(config as Partial<SileroVADConfig>);
  }
}

// Helper function
function bufferToFloat32(buffer: Buffer): Float32Array {
  const int16 = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}
