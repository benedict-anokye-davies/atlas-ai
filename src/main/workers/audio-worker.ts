/**
 * Atlas Desktop - Audio Processing Worker
 * Handles CPU-intensive audio processing tasks in a separate thread
 *
 * This worker performs:
 * - High-pass filtering (DC removal, rumble reduction)
 * - Noise gate (attenuate quiet sections)
 * - Noise reduction (spectral subtraction)
 * - Echo cancellation (NLMS adaptive filter)
 * - RMS level calculation
 * - Frequency spectrum analysis (FFT)
 */

import { parentPort, workerData } from 'worker_threads';
import {
  WorkerMessage,
  WorkerResponse,
  AudioWorkerOperation,
  AudioWorkerPayload,
  AudioWorkerResult,
  AudioProcessingConfig,
  AudioSpectrumData,
  AudioProcessingMetadata,
  DEFAULT_AUDIO_PROCESSING_CONFIG,
} from '../../shared/types/workers';

// Worker metadata from main thread
const { workerId, workerType } = workerData || {
  workerId: 'audio-worker',
  workerType: 'audio',
};

/**
 * Audio processing state (persistent across calls)
 */
interface AudioProcessorState {
  // Configuration
  config: AudioProcessingConfig;
  sampleRate: number;

  // High-pass filter state
  highPassPrev: number;
  highPassAlpha: number;

  // Noise gate state
  noiseGateGain: number;
  noiseGateActivations: number;

  // Noise estimation state
  noiseBuffer: Float32Array[];
  noiseFloor: Float32Array | null;
  noiseFloorEstimate: number;
  maxNoiseBufferFrames: number;

  // NLMS echo cancellation state
  nlmsWeights: Float32Array;
  nlmsReferenceBuffer: Float32Array;
  nlmsBufferIndex: number;
  nlmsConverged: boolean;
  nlmsErrorHistory: number[];
  echoReference: Float32Array | null;
  echoReferenceTimestamp: number;
  echoReductionDb: number;

  // Statistics
  framesProcessed: number;
  totalProcessingTime: number;
}

// Initialize processor state
let state: AudioProcessorState = createInitialState();

/**
 * Create initial processor state
 */
function createInitialState(config?: AudioProcessingConfig): AudioProcessorState {
  const cfg = config || DEFAULT_AUDIO_PROCESSING_CONFIG;
  const sampleRate = 16000;

  // Calculate high-pass filter coefficient
  const RC = 1.0 / (2.0 * Math.PI * cfg.highPassCutoff);
  const dt = 1.0 / sampleRate;
  const highPassAlpha = RC / (RC + dt);

  return {
    config: cfg,
    sampleRate,
    highPassPrev: 0,
    highPassAlpha,
    noiseGateGain: 1.0,
    noiseGateActivations: 0,
    noiseBuffer: [],
    noiseFloor: null,
    noiseFloorEstimate: 0,
    maxNoiseBufferFrames: 10,
    nlmsWeights: new Float32Array(cfg.nlmsFilterLength),
    nlmsReferenceBuffer: new Float32Array(cfg.nlmsFilterLength),
    nlmsBufferIndex: 0,
    nlmsConverged: false,
    nlmsErrorHistory: [],
    echoReference: null,
    echoReferenceTimestamp: 0,
    echoReductionDb: 0,
    framesProcessed: 0,
    totalProcessingTime: 0,
  };
}

// ============================================================================
// Audio Processing Functions
// ============================================================================

/**
 * Calculate RMS (Root Mean Square) level of audio
 */
function calculateRMS(samples: Float32Array): number {
  if (samples.length === 0) return 0;

  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Convert linear amplitude to decibels
 */
function linearToDb(linear: number): number {
  return 20 * Math.log10(Math.max(linear, 1e-10));
}

/**
 * Convert decibels to linear amplitude
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Apply high-pass filter to remove DC offset and low-frequency rumble
 */
function applyHighPass(input: Float32Array): Float32Array {
  const output = new Float32Array(input.length);
  let prevIn = input[0];
  let prevOut = state.highPassPrev;

  for (let i = 0; i < input.length; i++) {
    output[i] = state.highPassAlpha * (prevOut + input[i] - prevIn);
    prevIn = input[i];
    prevOut = output[i];
  }

  state.highPassPrev = prevOut;
  return output;
}

/**
 * Update noise floor estimate from quiet frames
 */
function updateNoiseEstimate(input: Float32Array): void {
  const level = calculateRMS(input);
  const levelDb = linearToDb(level);

  // Only update noise estimate during quiet periods
  if (levelDb < state.config.noiseGateThreshold + 10) {
    // Store frame for noise estimation
    const frameCopy = new Float32Array(input);
    state.noiseBuffer.push(frameCopy);

    // Keep only recent frames
    while (state.noiseBuffer.length > state.maxNoiseBufferFrames) {
      state.noiseBuffer.shift();
    }

    // Update noise floor estimate
    if (state.noiseBuffer.length >= state.maxNoiseBufferFrames / 2) {
      state.noiseFloor = estimateNoiseFloor();
      state.noiseFloorEstimate = calculateRMS(state.noiseFloor);
    }
  }
}

/**
 * Estimate noise floor from collected quiet frames
 */
function estimateNoiseFloor(): Float32Array {
  if (state.noiseBuffer.length === 0) {
    return new Float32Array(512);
  }

  const frameSize = state.noiseBuffer[0].length;
  const noiseFloor = new Float32Array(frameSize);

  // Average the absolute values across all noise frames
  for (let i = 0; i < frameSize; i++) {
    let sum = 0;
    for (const frame of state.noiseBuffer) {
      sum += Math.abs(frame[i]);
    }
    noiseFloor[i] = sum / state.noiseBuffer.length;
  }

  return noiseFloor;
}

/**
 * Apply noise reduction using spectral subtraction
 */
function applyNoiseReduction(input: Float32Array): Float32Array {
  if (!state.noiseFloor || state.noiseFloor.length !== input.length) {
    return input;
  }

  const output = new Float32Array(input.length);
  const strength = state.config.noiseReductionStrength;

  for (let i = 0; i < input.length; i++) {
    const sample = input[i];
    const noise = state.noiseFloor[i] * strength;

    // Soft thresholding - reduce samples near noise floor
    if (Math.abs(sample) < noise * 2) {
      const attenuation = Math.max(0, 1 - noise / (Math.abs(sample) + 1e-10));
      output[i] = sample * attenuation;
    } else {
      output[i] = sample;
    }
  }

  return output;
}

/**
 * Apply noise gate to attenuate very quiet sections
 */
function applyNoiseGate(input: Float32Array): Float32Array {
  const output = new Float32Array(input.length);
  const level = calculateRMS(input);
  const levelDb = linearToDb(level);
  const thresholdDb = state.config.noiseGateThreshold;

  // Calculate attack/release coefficients
  const attackSamples = (state.config.noiseGateAttack / 1000) * state.sampleRate;
  const releaseSamples = (state.config.noiseGateRelease / 1000) * state.sampleRate;
  const attackCoeff = Math.exp(-1.0 / attackSamples);
  const releaseCoeff = Math.exp(-1.0 / releaseSamples);

  // Determine target gain
  let targetGain: number;
  if (levelDb > thresholdDb) {
    targetGain = 1.0;
  } else if (levelDb > thresholdDb - 10) {
    // Soft knee
    const ratio = (levelDb - (thresholdDb - 10)) / 10;
    targetGain = ratio * ratio;
  } else {
    targetGain = 0.1;
    state.noiseGateActivations++;
  }

  // Smooth gain changes
  const coeff = targetGain > state.noiseGateGain ? attackCoeff : releaseCoeff;
  state.noiseGateGain = coeff * state.noiseGateGain + (1 - coeff) * targetGain;

  // Apply gain
  for (let i = 0; i < input.length; i++) {
    output[i] = input[i] * state.noiseGateGain;
  }

  return output;
}

/**
 * Apply NLMS (Normalized Least Mean Squares) adaptive filter for echo cancellation
 */
function applyNLMSEchoCancellation(input: Float32Array): Float32Array {
  if (!state.echoReference) {
    return input;
  }

  const output = new Float32Array(input.length);
  const filterLength = state.config.nlmsFilterLength;
  const mu = state.config.nlmsStepSize;
  const epsilon = 0.001;

  // Check if reference is recent enough (within 1 second)
  const now = Date.now();
  if (now - state.echoReferenceTimestamp > 1000) {
    state.echoReference = null;
    return input;
  }

  // Process each sample with NLMS algorithm
  for (let i = 0; i < input.length; i++) {
    // Get the reference sample (with delay compensation)
    const refIndex = Math.min(i, state.echoReference.length - 1);
    const refSample = refIndex >= 0 ? state.echoReference[refIndex] : 0;

    // Update circular reference buffer
    state.nlmsReferenceBuffer[state.nlmsBufferIndex] = refSample;

    // Compute estimated echo: y_hat = W^T * x
    let echoEstimate = 0;
    for (let j = 0; j < filterLength; j++) {
      const bufIdx = (state.nlmsBufferIndex - j + filterLength) % filterLength;
      echoEstimate += state.nlmsWeights[j] * state.nlmsReferenceBuffer[bufIdx];
    }

    // Compute error signal
    const error = input[i] - echoEstimate;
    output[i] = error;

    // Calculate normalization factor
    let refPower = epsilon;
    for (let j = 0; j < filterLength; j++) {
      const bufIdx = (state.nlmsBufferIndex - j + filterLength) % filterLength;
      refPower += state.nlmsReferenceBuffer[bufIdx] * state.nlmsReferenceBuffer[bufIdx];
    }

    // Update filter weights
    const normalizedStep = mu / refPower;
    for (let j = 0; j < filterLength; j++) {
      const bufIdx = (state.nlmsBufferIndex - j + filterLength) % filterLength;
      state.nlmsWeights[j] += normalizedStep * error * state.nlmsReferenceBuffer[bufIdx];
    }

    // Advance buffer index
    state.nlmsBufferIndex = (state.nlmsBufferIndex + 1) % filterLength;

    // Track error for convergence detection
    state.nlmsErrorHistory.push(Math.abs(error));
    if (state.nlmsErrorHistory.length > 50) {
      state.nlmsErrorHistory.shift();
    }
  }

  // Check for filter convergence
  if (state.nlmsErrorHistory.length >= 50) {
    const avgError =
      state.nlmsErrorHistory.reduce((a, b) => a + b, 0) / state.nlmsErrorHistory.length;
    state.nlmsConverged = avgError < 0.01;
  }

  // Calculate echo reduction
  const inputLevel = calculateRMS(input);
  const outputLevel = calculateRMS(output);
  if (inputLevel > 0) {
    state.echoReductionDb = linearToDb(outputLevel / inputLevel);
  }

  return output;
}

/**
 * Process a full audio frame through the pipeline
 */
function processFrame(samples: Float32Array, config?: AudioProcessingConfig): AudioWorkerResult {
  // Update config if provided
  if (config) {
    state.config = { ...state.config, ...config };
    // Recalculate high-pass coefficient if cutoff changed
    const RC = 1.0 / (2.0 * Math.PI * state.config.highPassCutoff);
    const dt = 1.0 / state.sampleRate;
    state.highPassAlpha = RC / (RC + dt);
  }

  let processed = samples;

  // 1. High-pass filter
  if (state.config.enableHighPass) {
    processed = applyHighPass(processed);
  }

  // 2. Noise estimation
  if (state.config.enableNoiseReduction) {
    updateNoiseEstimate(processed);
  }

  // 3. Noise reduction
  if (state.config.enableNoiseReduction && state.noiseFloor) {
    processed = applyNoiseReduction(processed);
  }

  // 4. Noise gate
  if (state.config.enableNoiseGate) {
    processed = applyNoiseGate(processed);
  }

  // 5. Echo cancellation
  if (state.config.enableEchoCancellation && state.echoReference) {
    processed = applyNLMSEchoCancellation(processed);
  }

  state.framesProcessed++;

  // Create metadata
  const metadata: AudioProcessingMetadata = {
    noiseGateTriggered: state.noiseGateGain < 0.5,
    noiseGateGain: state.noiseGateGain,
    echoCancellationActive: state.config.enableEchoCancellation && state.echoReference !== null,
    nlmsConverged: state.nlmsConverged,
    echoReductionDb: state.echoReductionDb,
  };

  return {
    samples: processed.buffer.slice(0) as ArrayBuffer,
    sampleCount: processed.length,
    rmsLevel: calculateRMS(processed),
    noiseFloor: state.noiseFloorEstimate,
    metadata,
  };
}

/**
 * Calculate frequency spectrum using simple DFT (FFT alternative)
 * For a full FFT, a library like fft.js would be needed
 */
function calculateSpectrum(samples: Float32Array): AudioSpectrumData {
  const fftSize = state.config.fftSize;
  const numBins = fftSize / 2;

  // Use a simplified DFT for the main frequency bands
  // In production, use a proper FFT library
  const magnitudes: number[] = new Array(numBins).fill(0);
  const frequencies: number[] = new Array(numBins).fill(0);
  const binWidth = state.sampleRate / fftSize;

  // Simple DFT calculation (O(n^2) - consider FFT for production)
  for (let k = 0; k < numBins; k++) {
    let real = 0;
    let imag = 0;
    const freq = k * binWidth;
    frequencies[k] = freq;

    for (let n = 0; n < Math.min(samples.length, fftSize); n++) {
      const angle = (2 * Math.PI * k * n) / fftSize;
      real += samples[n] * Math.cos(angle);
      imag -= samples[n] * Math.sin(angle);
    }

    magnitudes[k] = Math.sqrt(real * real + imag * imag) / fftSize;
  }

  // Calculate band energies
  const bandRanges = {
    bass: { min: 0, max: 200 },
    lowMid: { min: 200, max: 500 },
    mid: { min: 500, max: 2000 },
    highMid: { min: 2000, max: 4000 },
    treble: { min: 4000, max: state.sampleRate / 2 },
  };

  function getBandEnergy(minFreq: number, maxFreq: number): number {
    let energy = 0;
    let count = 0;
    for (let i = 0; i < frequencies.length; i++) {
      if (frequencies[i] >= minFreq && frequencies[i] < maxFreq) {
        energy += magnitudes[i];
        count++;
      }
    }
    return count > 0 ? energy / count : 0;
  }

  return {
    frequencies,
    magnitudes,
    bass: getBandEnergy(bandRanges.bass.min, bandRanges.bass.max),
    lowMid: getBandEnergy(bandRanges.lowMid.min, bandRanges.lowMid.max),
    mid: getBandEnergy(bandRanges.mid.min, bandRanges.mid.max),
    highMid: getBandEnergy(bandRanges.highMid.min, bandRanges.highMid.max),
    treble: getBandEnergy(bandRanges.treble.min, bandRanges.treble.max),
  };
}

/**
 * Reset all filter states
 */
function resetFilters(): void {
  state = createInitialState(state.config);
}

// ============================================================================
// Message Handling
// ============================================================================

/**
 * Handle incoming messages from the main thread
 */
function handleMessage(
  message: WorkerMessage<AudioWorkerPayload>
): WorkerResponse<AudioWorkerResult> {
  const startTime = performance.now();
  const operation = message.type as AudioWorkerOperation;

  try {
    let result: AudioWorkerResult;

    switch (operation) {
      case 'process-frame': {
        if (!message.payload.samples) {
          throw new Error('No samples provided for processing');
        }
        const samples = new Float32Array(message.payload.samples);
        result = processFrame(samples, message.payload.config);
        break;
      }

      case 'apply-high-pass': {
        if (!message.payload.samples) {
          throw new Error('No samples provided');
        }
        const samples = new Float32Array(message.payload.samples);
        const filtered = applyHighPass(samples);
        result = {
          samples: filtered.buffer.slice(0) as ArrayBuffer,
          sampleCount: filtered.length,
          rmsLevel: calculateRMS(filtered),
        };
        break;
      }

      case 'apply-noise-gate': {
        if (!message.payload.samples) {
          throw new Error('No samples provided');
        }
        const samples = new Float32Array(message.payload.samples);
        const gated = applyNoiseGate(samples);
        result = {
          samples: gated.buffer.slice(0) as ArrayBuffer,
          sampleCount: gated.length,
          rmsLevel: calculateRMS(gated),
          metadata: {
            noiseGateTriggered: state.noiseGateGain < 0.5,
            noiseGateGain: state.noiseGateGain,
            echoCancellationActive: false,
            nlmsConverged: false,
            echoReductionDb: 0,
          },
        };
        break;
      }

      case 'apply-noise-reduction': {
        if (!message.payload.samples) {
          throw new Error('No samples provided');
        }
        const samples = new Float32Array(message.payload.samples);
        updateNoiseEstimate(samples);
        const reduced = applyNoiseReduction(samples);
        result = {
          samples: reduced.buffer.slice(0),
          sampleCount: reduced.length,
          rmsLevel: calculateRMS(reduced),
          noiseFloor: state.noiseFloorEstimate,
        };
        break;
      }

      case 'apply-echo-cancellation': {
        if (!message.payload.samples) {
          throw new Error('No samples provided');
        }
        // Set echo reference if provided
        if (message.payload.echoReference) {
          state.echoReference = new Float32Array(message.payload.echoReference);
          state.echoReferenceTimestamp = Date.now();
        }
        const samples = new Float32Array(message.payload.samples);
        const cancelled = applyNLMSEchoCancellation(samples);
        result = {
          samples: cancelled.buffer.slice(0),
          sampleCount: cancelled.length,
          rmsLevel: calculateRMS(cancelled),
          metadata: {
            noiseGateTriggered: false,
            noiseGateGain: 1,
            echoCancellationActive: state.echoReference !== null,
            nlmsConverged: state.nlmsConverged,
            echoReductionDb: state.echoReductionDb,
          },
        };
        break;
      }

      case 'calculate-rms': {
        if (!message.payload.samples) {
          throw new Error('No samples provided');
        }
        const samples = new Float32Array(message.payload.samples);
        result = {
          rmsLevel: calculateRMS(samples),
        };
        break;
      }

      case 'calculate-spectrum': {
        if (!message.payload.samples) {
          throw new Error('No samples provided');
        }
        const samples = new Float32Array(message.payload.samples);
        result = {
          spectrum: calculateSpectrum(samples),
        };
        break;
      }

      case 'update-noise-estimate': {
        if (!message.payload.samples) {
          throw new Error('No samples provided');
        }
        const samples = new Float32Array(message.payload.samples);
        updateNoiseEstimate(samples);
        result = {
          noiseFloor: state.noiseFloorEstimate,
        };
        break;
      }

      case 'reset-filters': {
        resetFilters();
        result = {};
        break;
      }

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    const processingTime = performance.now() - startTime;
    state.totalProcessingTime += processingTime;

    return {
      id: message.id,
      success: true,
      result,
      processingTime,
      timestamp: Date.now(),
    };
  } catch (error) {
    const processingTime = performance.now() - startTime;

    return {
      id: message.id,
      success: false,
      error: (error as Error).message,
      processingTime,
      timestamp: Date.now(),
    };
  }
}

// ============================================================================
// Worker Entry Point
// ============================================================================

if (parentPort) {
  // Listen for messages from the main thread
  parentPort.on('message', (message: WorkerMessage<AudioWorkerPayload>) => {
    const response = handleMessage(message);
    parentPort!.postMessage(response);
  });

  // Signal that worker is ready
  // eslint-disable-next-line no-console
  console.log(`[AudioWorker] ${workerId} (${workerType}) initialized`);
}

export {
  handleMessage,
  calculateRMS,
  applyHighPass,
  applyNoiseGate,
  applyNoiseReduction,
  applyNLMSEchoCancellation,
  calculateSpectrum,
  resetFilters,
};
