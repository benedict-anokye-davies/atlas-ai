/**
 * Audio Test Fixtures
 * Sample audio data for testing voice pipeline components
 */

/**
 * Creates a silent audio buffer (Int16Array)
 */
export function createSilentAudio(samples = 1024): Int16Array {
  return new Int16Array(samples).fill(0);
}

/**
 * Creates a sine wave audio buffer
 */
export function createSineWave(
  frequency = 440,
  sampleRate = 16000,
  duration = 0.1,
  amplitude = 0.5
): Int16Array {
  const samples = Math.floor(sampleRate * duration);
  const buffer = new Int16Array(samples);
  const maxAmplitude = 32767 * amplitude;

  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    buffer[i] = Math.floor(Math.sin(2 * Math.PI * frequency * t) * maxAmplitude);
  }

  return buffer;
}

/**
 * Creates white noise audio buffer
 */
export function createWhiteNoise(samples = 1024, amplitude = 0.1): Int16Array {
  const buffer = new Int16Array(samples);
  const maxAmplitude = 32767 * amplitude;

  for (let i = 0; i < samples; i++) {
    buffer[i] = Math.floor((Math.random() * 2 - 1) * maxAmplitude);
  }

  return buffer;
}

/**
 * Creates audio buffer simulating speech-like characteristics
 * (variable amplitude with occasional silence)
 */
export function createSpeechLikeAudio(sampleRate = 16000, duration = 1.0): Int16Array {
  const samples = Math.floor(sampleRate * duration);
  const buffer = new Int16Array(samples);

  // Simulate speech with varying amplitude
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    // Amplitude envelope that varies like speech
    const envelope = Math.abs(Math.sin(2 * Math.PI * 3 * t)) * Math.abs(Math.sin(2 * Math.PI * 0.5 * t));
    // Base frequency with harmonics
    const baseFreq = 150;
    const signal =
      Math.sin(2 * Math.PI * baseFreq * t) * 0.5 +
      Math.sin(2 * Math.PI * baseFreq * 2 * t) * 0.3 +
      Math.sin(2 * Math.PI * baseFreq * 3 * t) * 0.2;

    buffer[i] = Math.floor(signal * envelope * 16383);
  }

  return buffer;
}

/**
 * Creates audio buffer for VAD testing (speech segment between silence)
 */
export function createVADTestAudio(
  sampleRate = 16000,
  silenceBefore = 0.5,
  speechDuration = 1.0,
  silenceAfter = 0.5
): Int16Array {
  const silenceBeforeSamples = Math.floor(sampleRate * silenceBefore);
  const speechSamples = Math.floor(sampleRate * speechDuration);
  const silenceAfterSamples = Math.floor(sampleRate * silenceAfter);
  const totalSamples = silenceBeforeSamples + speechSamples + silenceAfterSamples;

  const buffer = new Int16Array(totalSamples);

  // Fill silence before
  buffer.fill(0, 0, silenceBeforeSamples);

  // Fill speech segment
  const speech = createSpeechLikeAudio(sampleRate, speechDuration);
  buffer.set(speech, silenceBeforeSamples);

  // Fill silence after
  buffer.fill(0, silenceBeforeSamples + speechSamples);

  return buffer;
}

/**
 * Creates audio buffer chunks for streaming tests
 */
export function createAudioChunks(
  totalDuration = 3.0,
  chunkDuration = 0.1,
  sampleRate = 16000
): Int16Array[] {
  const chunks: Int16Array[] = [];
  const samplesPerChunk = Math.floor(sampleRate * chunkDuration);
  const totalChunks = Math.ceil(totalDuration / chunkDuration);

  for (let i = 0; i < totalChunks; i++) {
    // Alternate between speech-like and quieter segments
    const isSpeech = i % 5 < 3;
    if (isSpeech) {
      chunks.push(createSpeechLikeAudio(sampleRate, chunkDuration));
    } else {
      chunks.push(createSilentAudio(samplesPerChunk));
    }
  }

  return chunks;
}

/**
 * Converts Int16Array to Float32Array (for VAD processing)
 */
export function int16ToFloat32(int16: Int16Array): Float32Array {
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

/**
 * Converts Float32Array to Int16Array
 */
export function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

/**
 * Standard audio frame sizes used in the pipeline
 */
export const AUDIO_FRAME_SIZES = {
  PORCUPINE: 512, // Porcupine frame length
  VAD: 1536, // Silero VAD frame length (96ms at 16kHz)
  DEEPGRAM: 3200, // 200ms at 16kHz
  STANDARD: 16000, // 1 second at 16kHz
};

/**
 * Sample rates used in the pipeline
 */
export const SAMPLE_RATES = {
  STANDARD: 16000,
  HIGH: 44100,
  MEDIUM: 22050,
};
