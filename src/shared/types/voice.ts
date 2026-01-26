/**
 * Atlas Voice Pipeline Types
 */

/**
 * Wake word detection events
 */
export interface WakeWordEvent {
  timestamp: number;
  keyword: string;
  confidence: number;
}

/**
 * Wake word detector configuration
 */
export interface WakeWordConfig {
  accessKey: string;
  keywords: BuiltInKeyword[];
  sensitivities?: number[];
  modelPath?: string;
}

/**
 * Built-in Porcupine keywords
 */
export type BuiltInKeyword =
  | 'alexa'
  | 'americano'
  | 'blueberry'
  | 'bumblebee'
  | 'computer'
  | 'grapefruit'
  | 'grasshopper'
  | 'hey google'
  | 'hey siri'
  | 'jarvis'
  | 'ok google'
  | 'picovoice'
  | 'porcupine'
  | 'terminator';

/**
 * Wake phrase configuration for user-friendly multi-phrase support
 */
export interface WakePhraseConfig {
  /** Display name shown in settings (e.g., "Hey Atlas", "Computer") */
  displayName: string;
  /** Underlying Porcupine keyword or custom model path */
  keyword: BuiltInKeyword | string;
  /** Whether this is a custom trained model (.ppn file) */
  isCustomModel: boolean;
  /** Sensitivity for this phrase (0-1, higher = more sensitive) */
  sensitivity: number;
  /** Is this phrase enabled */
  enabled: boolean;
}

/**
 * Default wake phrase presets
 */
export const WAKE_PHRASE_PRESETS: WakePhraseConfig[] = [
  {
    displayName: 'Hey Atlas',
    keyword: 'jarvis', // Fallback to jarvis until custom model is trained
    isCustomModel: false,
    sensitivity: 0.5,
    enabled: true,
  },
  {
    displayName: 'Computer',
    keyword: 'computer',
    isCustomModel: false,
    sensitivity: 0.5,
    enabled: false,
  },
  {
    displayName: 'Jarvis',
    keyword: 'jarvis',
    isCustomModel: false,
    sensitivity: 0.5,
    enabled: false,
  },
  {
    displayName: 'Hey Siri',
    keyword: 'hey siri',
    isCustomModel: false,
    sensitivity: 0.5,
    enabled: false,
  },
  {
    displayName: 'Alexa',
    keyword: 'alexa',
    isCustomModel: false,
    sensitivity: 0.4,
    enabled: false,
  },
];

/**
 * Multiple wake phrase settings
 */
export interface WakePhraseSettings {
  /** List of configured wake phrases */
  phrases: WakePhraseConfig[];
  /** Whether to use the first match or require all phrases */
  matchMode: 'first' | 'any';
  /** Global sensitivity multiplier (applies to all phrases) */
  globalSensitivity: number;
  /** Cooldown between triggers in ms */
  cooldownMs: number;
}

/**
 * Audio input device info
 */
export interface AudioDevice {
  index: number;
  name: string;
  isDefault: boolean;
}

/**
 * Audio input configuration
 */
export interface AudioInputConfig {
  deviceIndex?: number;
  sampleRate: number;
  frameLength: number;
}

/**
 * Voice pipeline states
 */
export type VoicePipelineState =
  | 'idle' // Waiting for wake word
  | 'listening' // Capturing user speech
  | 'processing' // STT/LLM processing
  | 'speaking' // TTS playback
  | 'error'; // Error state

/**
 * Voice pipeline status
 */
export interface VoicePipelineStatus {
  state: VoicePipelineState;
  isListening: boolean;
  isSpeaking: boolean;
  audioLevel: number;
  lastWakeWord?: WakeWordEvent;
  error?: string;
}

/**
 * Voice activity detection event
 */
export interface VADEvent {
  type: 'speech-start' | 'speech-end';
  timestamp: number;
  duration?: number; // Only for speech-end
}

/**
 * Audio chunk for processing
 */
export interface AudioChunk {
  samples: Int16Array;
  timestamp: number;
  sampleRate: number;
}

/**
 * Transcript from STT
 */
export interface Transcript {
  text: string;
  isFinal: boolean;
  confidence: number;
  timestamp: number;
}

/**
 * VAD configuration options
 */
export interface VADConfig {
  /** Speech probability threshold (0-1), default 0.5 */
  threshold?: number;
  /** Minimum speech duration in ms before triggering, default 250 */
  minSpeechDuration?: number;
  /** Silence duration in ms to end speech segment, default 1500 */
  silenceDuration?: number;
  /** Maximum speech duration in ms before forced end, default 30000 */
  maxSpeechDuration?: number;
  /** Sample rate, default 16000 */
  sampleRate?: number;
  /** Frame size in samples, default 512 */
  frameSize?: number;
}

/**
 * Default VAD configuration
 */
export const DEFAULT_VAD_CONFIG: Required<VADConfig> = {
  threshold: 0.5,
  minSpeechDuration: 250,
  silenceDuration: 1500,
  maxSpeechDuration: 30000,
  sampleRate: 16000,
  frameSize: 512,
};

/**
 * Speech segment from VAD
 */
export interface SpeechSegment {
  /** Audio samples for the speech segment */
  audio: Float32Array;
  /** Start timestamp in ms */
  startTime: number;
  /** End timestamp in ms */
  endTime: number;
  /** Duration in ms */
  duration: number;
  /** Whether segment was force-ended due to max duration */
  forcedEnd: boolean;
}

/**
 * VAD status
 */
export interface VADStatus {
  /** Is VAD currently running */
  isRunning: boolean;
  /** Is speech currently detected */
  isSpeaking: boolean;
  /** Current speech probability (0-1) */
  probability: number;
  /** Duration of current speech segment in ms */
  speechDuration: number;
}

/**
 * Extended Voice Pipeline Status (includes STT/LLM/TTS state)
 * Used for the full voice pipeline with AI integration
 */
export interface FullVoicePipelineStatus extends VoicePipelineStatus {
  /** Current STT provider name */
  sttProvider: string | null;
  /** Current LLM provider name */
  llmProvider: string | null;
  /** Whether TTS is currently speaking */
  isTTSSpeaking: boolean;
  /** Current transcript from STT */
  currentTranscript: string;
  /** Current response from LLM */
  currentResponse: string;
}

/**
 * Wake word feedback types for UI visualization
 */
export type WakeWordFeedbackType =
  | 'detected' // Wake word detected and validated
  | 'rejected' // Wake word detected but below confidence threshold
  | 'cooldown' // Wake word detected but in cooldown period
  | 'listening' // Actively listening for wake word
  | 'ready'; // Ready to detect wake word

/**
 * Wake word feedback event sent to UI
 */
export interface WakeWordFeedback {
  type: WakeWordFeedbackType;
  timestamp: number;
  keyword?: string;
  confidence?: number;
  threshold?: number;
  audioLevel?: number;
  message?: string;
}

/**
 * Confidence thresholding configuration for wake word detection
 */
export interface ConfidenceConfig {
  /** Minimum confidence threshold (0-1), detections below this are rejected */
  minThreshold: number;
  /** Require audio level above this to validate detection */
  minAudioLevel: number;
  /** Number of recent audio levels to track for ambient estimation */
  audioHistorySize: number;
  /** Multiplier for ambient noise to set dynamic threshold */
  ambientMultiplier: number;
  /** Enable adaptive thresholding based on ambient noise */
  adaptiveThreshold: boolean;
}

/**
 * Extended wake word event with confidence details
 */
export interface ExtendedWakeWordEvent extends WakeWordEvent {
  /** Raw detection confidence from Porcupine (based on sensitivity) */
  rawConfidence: number;
  /** Computed confidence based on audio analysis */
  computedConfidence: number;
  /** Whether detection passed threshold validation */
  passedThreshold: boolean;
  /** Audio level at time of detection */
  audioLevel: number;
  /** Ambient noise level estimate */
  ambientLevel: number;
}

/**
 * Detection statistics for monitoring wake word performance
 */
export interface DetectionStats {
  totalDetections: number;
  acceptedDetections: number;
  rejectedDetections: number;
  cooldownRejections: number;
  averageConfidence: number;
  lastDetectionTime: number;
  uptime: number;
}

/**
 * Listening state for VAD UI feedback
 */
export type ListeningState =
  | 'idle' // Not listening
  | 'listening' // Actively listening for speech
  | 'hearing' // Speech detected, capturing
  | 'still_listening' // Pause detected, waiting for more
  | 'processing'; // Speech complete, processing

/**
 * Still listening event - emitted when VAD detects a pause but expects more speech
 */
export interface StillListeningEvent {
  timestamp: number;
  pauseDuration: number;
  reason: 'incomplete_sentence' | 'short_pause' | 'thinking_pause';
  extendedTimeout: number;
}

/**
 * Adaptive silence configuration for VAD
 */
export interface AdaptiveSilenceConfig {
  /** Base silence duration (ms) before ending speech */
  baseSilenceMs: number;
  /** Extended silence for incomplete sentences (ms) */
  incompleteSilenceMs: number;
  /** Short pause threshold - pauses shorter trigger "still listening" */
  shortPauseMs: number;
  /** Maximum silence before forced end (ms) */
  maxSilenceMs: number;
  /** Enable sentence ending detection */
  detectSentenceEndings: boolean;
  /** Enable adaptive timeout based on transcript */
  adaptiveTimeout: boolean;
}

// ============================================================================
// System Audio Ducking Types
// ============================================================================

/**
 * System audio ducking configuration
 * Controls automatic volume reduction of other applications when Atlas speaks
 */
export interface SystemAudioDuckingConfig {
  /** Enable system audio ducking */
  enabled: boolean;
  /** Target volume level when ducking (0-1, e.g., 0.3 = 30% of original) */
  duckLevel: number;
  /** Attack time in ms (how fast to lower volume) */
  attackMs: number;
  /** Release time in ms (how fast to restore volume) */
  releaseMs: number;
  /** Hold time in ms (how long to hold ducked level after TTS ends) */
  holdMs: number;
  /** Minimum volume (never go below this, 0-1) */
  minVolume: number;
  /** Maximum volume to restore to (in case user lowered it, 0-1) */
  maxVolume: number;
  /** Exclude Atlas's own audio process from ducking detection */
  excludeSelf: boolean;
  /** List of process names to exclude from ducking (e.g., 'atlas.exe') */
  excludedProcesses: string[];
  /** Fade curve type for smooth transitions */
  fadeType: 'linear' | 'exponential' | 'logarithmic';
}

/**
 * Default system audio ducking configuration
 */
export const DEFAULT_SYSTEM_AUDIO_DUCKING_CONFIG: SystemAudioDuckingConfig = {
  enabled: false, // Opt-in feature
  duckLevel: 0.3, // Reduce to 30% (50% reduction from original)
  attackMs: 150, // 150ms to lower volume
  releaseMs: 500, // 500ms to restore volume
  holdMs: 200, // Hold ducked level 200ms after TTS ends
  minVolume: 0.1, // Never go below 10%
  maxVolume: 1.0, // Restore to full volume
  excludeSelf: true,
  excludedProcesses: ['atlas.exe', 'Atlas.exe'],
  fadeType: 'exponential',
};

/**
 * System audio ducking state
 */
export type SystemDuckingState =
  | 'idle' // Not ducking
  | 'attacking' // Lowering volume
  | 'ducked' // Volume lowered, TTS playing
  | 'holding' // TTS ended, holding ducked level
  | 'releasing'; // Restoring volume

/**
 * System audio ducking status
 */
export interface SystemDuckingStatus {
  /** Current ducking state */
  state: SystemDuckingState;
  /** Current system volume (0-1) */
  currentVolume: number;
  /** Volume before ducking started (0-1) */
  originalVolume: number;
  /** Target volume for current state (0-1) */
  targetVolume: number;
  /** Is ducking currently active */
  isActive: boolean;
  /** Time ducking started (ms timestamp) */
  duckStartTime: number;
  /** Last error if any */
  lastError?: string;
}

/**
 * Audio session info for per-app volume control (Windows)
 */
export interface AudioSessionInfo {
  /** Process ID */
  pid: number;
  /** Process name */
  processName: string;
  /** Session display name */
  displayName: string;
  /** Current volume level (0-1) */
  volume: number;
  /** Is session muted */
  isMuted: boolean;
  /** Is this Atlas's own audio session */
  isSelf: boolean;
}

/**
 * System audio ducking events
 */
export interface SystemDuckingEvents {
  /** Ducking state changed */
  'state-change': (from: SystemDuckingState, to: SystemDuckingState) => void;
  /** Volume changed during ducking */
  'volume-change': (volume: number) => void;
  /** Ducking started */
  'duck-start': (originalVolume: number) => void;
  /** Ducking ended */
  'duck-end': (restoredVolume: number) => void;
  /** Error occurred */
  error: (error: Error) => void;
}

// ============================================================================
// Audio Analysis Types for Orb Reactivity
// ============================================================================

/**
 * Audio spectrum data for visualization
 * Provides frequency-band energy levels for particle reactivity
 */
export interface AudioSpectrum {
  /** Timestamp of analysis */
  timestamp: number;
  /** Overall RMS level (0-1) */
  level: number;
  /** Low frequency energy - bass (0-1) */
  bass: number;
  /** Low-mid frequency energy (0-1) */
  lowMid: number;
  /** Mid frequency energy (0-1) */
  mid: number;
  /** High-mid frequency energy (0-1) */
  highMid: number;
  /** High frequency energy - treble (0-1) */
  treble: number;
  /** Beat/pulse detection (0-1, spikes on beats) */
  pulse: number;
  /** Smoothed expansion factor for particle scale (0.8-1.5) */
  expansion: number;
}

/**
 * Configuration for audio analysis
 */
export interface AudioAnalysisConfig {
  /** FFT size (power of 2, default 256) */
  fftSize: number;
  /** Smoothing factor for frequency data (0-1, default 0.8) */
  smoothingTimeConstant: number;
  /** Target update rate in Hz (default 60) */
  targetFps: number;
  /** Enable beat detection */
  enableBeatDetection: boolean;
  /** Beat detection threshold multiplier */
  beatThreshold: number;
  /** Expansion base value */
  expansionBase: number;
  /** Expansion audio multiplier */
  expansionAudioMultiplier: number;
}

/**
 * Default audio analysis configuration
 */
export const DEFAULT_AUDIO_ANALYSIS_CONFIG: AudioAnalysisConfig = {
  fftSize: 256,
  smoothingTimeConstant: 0.8,
  targetFps: 60,
  enableBeatDetection: true,
  beatThreshold: 1.5,
  expansionBase: 1.0,
  expansionAudioMultiplier: 0.3,
};

// ============================================================================
// Adaptive VAD Types
// ============================================================================

/**
 * VAD sensitivity modes
 * - aggressive: High threshold, minimal false positives, may miss quiet speech
 * - balanced: Default mode, good balance of sensitivity and false positive rejection
 * - permissive: Low threshold, catches more speech, may have more false positives
 */
export type VADMode = 'aggressive' | 'balanced' | 'permissive';

/**
 * VAD mode presets with corresponding threshold configurations
 */
export interface VADModePreset {
  /** Display name for UI */
  name: string;
  /** Description of the mode */
  description: string;
  /** Positive speech threshold (0-1) */
  positiveSpeechThreshold: number;
  /** Negative speech threshold (0-1) */
  negativeSpeechThreshold: number;
  /** Minimum speech frames before triggering */
  minSpeechFrames: number;
  /** Redemption frames before ending speech */
  redemptionFrames: number;
  /** Noise floor multiplier for adaptive threshold */
  noiseFloorMultiplier: number;
  /** SNR (Signal-to-Noise Ratio) required for speech detection */
  minSNR: number;
}

/**
 * Default VAD mode presets - lowered thresholds for better speech detection
 */
export const VAD_MODE_PRESETS: Record<VADMode, VADModePreset> = {
  aggressive: {
    name: 'Aggressive',
    description: 'Higher threshold for noisy environments, but still sensitive.',
    positiveSpeechThreshold: 0.3,   // Lowered from 0.7
    negativeSpeechThreshold: 0.15,  // Lowered from 0.5
    minSpeechFrames: 3,             // Lowered from 5
    redemptionFrames: 10,           // Increased from 6
    noiseFloorMultiplier: 2.5,
    minSNR: 10,                     // Lowered from 15
  },
  balanced: {
    name: 'Balanced',
    description: 'Default mode with good sensitivity.',
    positiveSpeechThreshold: 0.2,   // Lowered from 0.5
    negativeSpeechThreshold: 0.1,   // Lowered from 0.35
    minSpeechFrames: 2,             // Lowered from 3
    redemptionFrames: 12,           // Increased from 8
    noiseFloorMultiplier: 2.0,
    minSNR: 6,                      // Lowered from 10
  },
  permissive: {
    name: 'Permissive',
    description: 'Very low threshold, catches all speech. Best for quiet mics.',
    positiveSpeechThreshold: 0.1,   // Lowered from 0.35
    negativeSpeechThreshold: 0.05,  // Lowered from 0.2
    minSpeechFrames: 1,             // Lowered from 2
    redemptionFrames: 15,           // Increased from 10
    noiseFloorMultiplier: 1.5,
    minSNR: 3,                      // Lowered from 6
  },
};

/**
 * Noise profile learned during initialization
 */
export interface NoiseProfile {
  /** Average noise floor level (RMS) */
  noiseFloor: number;
  /** Peak noise level observed */
  peakNoiseLevel: number;
  /** Standard deviation of noise */
  noiseStdDev: number;
  /** Estimated SNR for speech detection */
  estimatedSNR: number;
  /** Frequency spectrum characteristics (simplified) */
  spectralProfile: {
    /** Low frequency energy (0-500Hz) */
    lowFreqEnergy: number;
    /** Mid frequency energy (500-2000Hz) */
    midFreqEnergy: number;
    /** High frequency energy (2000Hz+) */
    highFreqEnergy: number;
  };
  /** Timestamp when profile was created */
  createdAt: number;
  /** Duration of profiling in ms */
  profilingDuration: number;
  /** Number of samples used for profiling */
  sampleCount: number;
  /** Is the profile valid/usable */
  isValid: boolean;
  /** Detected environment type */
  environmentType: NoiseEnvironmentType;
}

/**
 * Detected noise environment types
 */
export type NoiseEnvironmentType =
  | 'quiet' // Very low ambient noise (library, recording studio)
  | 'normal' // Normal indoor environment (office, home)
  | 'noisy' // Higher noise level (open office, cafe)
  | 'very_noisy' // Very high noise (street, factory)
  | 'unknown'; // Unable to classify

/**
 * Noise environment thresholds for classification
 */
export const NOISE_ENVIRONMENT_THRESHOLDS = {
  quiet: { maxNoiseFloor: 0.01, maxPeak: 0.02 },
  normal: { maxNoiseFloor: 0.03, maxPeak: 0.08 },
  noisy: { maxNoiseFloor: 0.08, maxPeak: 0.2 },
  very_noisy: { maxNoiseFloor: 1.0, maxPeak: 1.0 },
};

/**
 * Adaptive VAD threshold configuration
 */
export interface AdaptiveVADConfig {
  /** Enable adaptive threshold adjustment */
  enabled: boolean;
  /** Current VAD mode */
  mode: VADMode;
  /** Duration for initial noise profiling (ms) */
  noiseProfilingDuration: number;
  /** Interval for noise profile updates (ms, 0 to disable) */
  noiseProfileUpdateInterval: number;
  /** Enable automatic mode selection based on noise profile */
  autoModeSelection: boolean;
  /** Minimum threshold (never go below this even in quiet environments) */
  minThreshold: number;
  /** Maximum threshold (never go above this even in noisy environments) */
  maxThreshold: number;
  /** Smoothing factor for threshold adjustments (0-1, higher = smoother) */
  thresholdSmoothing: number;
  /** Enable spectral analysis for better noise rejection */
  enableSpectralAnalysis: boolean;
  /** Weight for noise floor in adaptive calculation (0-1) */
  noiseFloorWeight: number;
  /** Weight for recent activity in adaptive calculation (0-1) */
  activityWeight: number;
}

/**
 * Default adaptive VAD configuration
 */
export const DEFAULT_ADAPTIVE_VAD_CONFIG: AdaptiveVADConfig = {
  enabled: true,
  mode: 'balanced',
  noiseProfilingDuration: 2000, // 2 seconds of noise profiling
  noiseProfileUpdateInterval: 30000, // Update every 30 seconds
  autoModeSelection: false, // Disable auto mode selection - keep permissive for voice commands
  minThreshold: 0.05,
  maxThreshold: 0.25, // Cap max to keep VAD sensitive
  thresholdSmoothing: 0.7,
  enableSpectralAnalysis: true,
  noiseFloorWeight: 0.2, // Reduce noise impact on threshold
  activityWeight: 0.2, // Reduce activity impact on threshold
};

/**
 * VAD accuracy metrics for monitoring and tuning
 */
export interface VADAccuracyMetrics {
  /** Total speech segments detected */
  totalSpeechSegments: number;
  /** Speech segments that resulted in valid transcripts */
  validTranscripts: number;
  /** Speech segments that were too short (misfires) */
  misfires: number;
  /** Speech segments with no transcript (false positives) */
  falsePositives: number;
  /** Estimated missed speech events (based on STT gaps) */
  estimatedMissed: number;
  /** Average speech segment duration (ms) */
  avgSpeechDuration: number;
  /** Average silence between segments (ms) */
  avgSilenceDuration: number;
  /** Current detection accuracy (valid / total) */
  accuracy: number;
  /** Current false positive rate */
  falsePositiveRate: number;
  /** Uptime since metrics started (ms) */
  uptime: number;
  /** Last metric update timestamp */
  lastUpdated: number;
  /** Metrics per mode for comparison */
  modeMetrics: Record<VADMode, VADModeMetrics>;
}

/**
 * Per-mode VAD metrics
 */
export interface VADModeMetrics {
  /** Time spent in this mode (ms) */
  timeInMode: number;
  /** Speech segments detected in this mode */
  segmentsDetected: number;
  /** Valid transcripts in this mode */
  validTranscripts: number;
  /** False positives in this mode */
  falsePositives: number;
}

/**
 * Default VAD accuracy metrics
 */
export const DEFAULT_VAD_ACCURACY_METRICS: VADAccuracyMetrics = {
  totalSpeechSegments: 0,
  validTranscripts: 0,
  misfires: 0,
  falsePositives: 0,
  estimatedMissed: 0,
  avgSpeechDuration: 0,
  avgSilenceDuration: 0,
  accuracy: 0,
  falsePositiveRate: 0,
  uptime: 0,
  lastUpdated: 0,
  modeMetrics: {
    aggressive: { timeInMode: 0, segmentsDetected: 0, validTranscripts: 0, falsePositives: 0 },
    balanced: { timeInMode: 0, segmentsDetected: 0, validTranscripts: 0, falsePositives: 0 },
    permissive: { timeInMode: 0, segmentsDetected: 0, validTranscripts: 0, falsePositives: 0 },
  },
};

/**
 * Real-time adaptive threshold state
 */
export interface AdaptiveThresholdState {
  /** Current effective threshold */
  currentThreshold: number;
  /** Base threshold from mode preset */
  baseThreshold: number;
  /** Adjustment from noise profile (-1 to +1) */
  noiseAdjustment: number;
  /** Adjustment from recent activity (-1 to +1) */
  activityAdjustment: number;
  /** Current noise floor estimate */
  currentNoiseFloor: number;
  /** Recent speech probability history */
  recentProbabilities: number[];
  /** Is threshold currently adapting */
  isAdapting: boolean;
  /** Last adaptation timestamp */
  lastAdaptation: number;
}

/**
 * Extended VAD status with adaptive information
 */
export interface AdaptiveVADStatus extends VADStatus {
  /** Current VAD mode */
  mode: VADMode;
  /** Adaptive threshold state */
  adaptiveState: AdaptiveThresholdState;
  /** Current noise profile */
  noiseProfile: NoiseProfile | null;
  /** Accuracy metrics */
  metrics: VADAccuracyMetrics;
  /** Is noise profiling in progress */
  isProfilingNoise: boolean;
  /** Recommended mode based on environment */
  recommendedMode: VADMode;
}

/**
 * VAD events for adaptive system
 */
export interface AdaptiveVADEvents {
  /** Noise profile updated */
  'noise-profile-updated': (profile: NoiseProfile) => void;
  /** Mode changed */
  'mode-changed': (from: VADMode, to: VADMode, reason: string) => void;
  /** Threshold adapted */
  'threshold-adapted': (state: AdaptiveThresholdState) => void;
  /** Metrics updated */
  'metrics-updated': (metrics: VADAccuracyMetrics) => void;
  /** Environment type changed */
  'environment-changed': (type: NoiseEnvironmentType) => void;
}

// ============================================================================
// Continuous Listening Mode Types
// ============================================================================

/**
 * Continuous listening mode - allows hands-free conversation without wake word
 */
export type ContinuousListeningMode =
  | 'disabled'        // Standard mode - requires wake word for each interaction
  | 'enabled'         // Continuous mode - auto-listen after response
  | 'paused';         // Temporarily paused but will resume

/**
 * Configuration for continuous listening mode
 */
export interface ContinuousListeningConfig {
  /** Enable continuous listening mode */
  enabled: boolean;
  /** Silence timeout in seconds before returning to idle (5-30) */
  silenceTimeoutSeconds: number;
  /** Whether wake word is still required to initially activate */
  requireWakeWordToActivate: boolean;
  /** Auto-disable after N consecutive silent timeouts (0 = never) */
  autoDisableAfterTimeouts: number;
  /** Voice commands to control mode */
  voiceCommands: {
    /** Command to enable continuous mode (e.g., "Keep listening") */
    enable: string[];
    /** Command to disable continuous mode (e.g., "Stop listening") */
    disable: string[];
    /** Command to pause temporarily (e.g., "Pause") */
    pause: string[];
  };
  /** Play audio cue when entering/exiting continuous mode */
  playAudioCues: boolean;
  /** Extend timeout when user is mid-sentence (detected via incomplete STT) */
  extendOnIncompleteSpeech: boolean;
}

/**
 * Default continuous listening configuration
 * Enabled by default for JARVIS-like always-available behavior
 */
export const DEFAULT_CONTINUOUS_LISTENING_CONFIG: ContinuousListeningConfig = {
  enabled: true,
  silenceTimeoutSeconds: 15,
  requireWakeWordToActivate: true,
  autoDisableAfterTimeouts: 5,
  voiceCommands: {
    enable: ['keep listening', 'continuous mode', 'stay listening', "don't go away", 'stay awake'],
    disable: ['stop listening', 'that\'s all', 'go to sleep', 'goodbye', "that's it"],
    pause: ['pause', 'hold on', 'one moment', 'wait', 'hang on'],
  },
  playAudioCues: true,
  extendOnIncompleteSpeech: true,
};

/**
 * Continuous listening state for status reporting
 */
export interface ContinuousListeningState {
  /** Current mode */
  mode: ContinuousListeningMode;
  /** Is actively listening in continuous mode */
  isActive: boolean;
  /** Current silence duration in ms */
  currentSilenceMs: number;
  /** Configured timeout in ms */
  timeoutMs: number;
  /** Consecutive timeouts since last interaction */
  consecutiveTimeouts: number;
  /** Time remaining before timeout (ms) */
  timeRemaining: number;
  /** Is timeout currently extended due to incomplete speech */
  isExtended: boolean;
  /** Timestamp when continuous mode was activated */
  activatedAt: number;
  /** Total interactions in this continuous session */
  interactionCount: number;
}

/**
 * Events emitted by continuous listening system
 */
export interface ContinuousListeningEvents {
  /** Mode changed */
  'continuous-mode-change': (mode: ContinuousListeningMode, previousMode: ContinuousListeningMode) => void;
  /** Continuous listening activated */
  'continuous-activated': (reason: 'voice_command' | 'api' | 'config') => void;
  /** Continuous listening deactivated */
  'continuous-deactivated': (reason: 'voice_command' | 'api' | 'timeout' | 'auto_disable') => void;
  /** Silence timeout warning (e.g., 5 seconds remaining) */
  'continuous-timeout-warning': (timeRemainingMs: number) => void;
  /** Silence timeout occurred */
  'continuous-timeout': (consecutiveCount: number) => void;
  /** Timeout extended due to incomplete speech */
  'continuous-timeout-extended': (newTimeoutMs: number) => void;
  /** State update for UI */
  'continuous-state-update': (state: ContinuousListeningState) => void;
}

/**
 * Voice command detection result
 */
export interface VoiceCommandResult {
  /** Was a voice command detected */
  detected: boolean;
  /** Type of command if detected */
  commandType?: 'enable' | 'disable' | 'pause';
  /** The matched command phrase */
  matchedPhrase?: string;
  /** Confidence of match (0-1) */
  confidence: number;
  /** Original transcript */
  originalText: string;
}

// ============================================================================
// Noise Profile Learning Types
// ============================================================================

/**
 * Named noise profile for specific environments
 */
export interface NamedNoiseProfile extends NoiseProfile {
  /** Unique identifier for the profile */
  id: string;
  /** User-friendly name (e.g., "Office", "Home", "Coffee Shop") */
  name: string;
  /** Optional description */
  description?: string;
  /** Whether this is the default profile */
  isDefault: boolean;
  /** Number of times this profile has been used */
  usageCount: number;
  /** Last time this profile was used */
  lastUsed: number;
  /** Auto-detected location hint (if available) */
  locationHint?: string;
}

/**
 * Noise level indicator data for UI display
 */
export interface NoiseLevelIndicator {
  /** Current noise level (0-1) */
  level: number;
  /** Level in decibels (-60 to 0) */
  levelDb: number;
  /** Peak level in recent history (0-1) */
  peak: number;
  /** Average level (0-1) */
  average: number;
  /** Noise floor from profile (0-1) */
  noiseFloor: number;
  /** Current SNR estimate in dB */
  snrDb: number;
  /** Environment quality indicator (0-1, 1 = ideal for speech) */
  quality: number;
  /** Status message for UI */
  status: 'excellent' | 'good' | 'fair' | 'poor' | 'learning';
  /** Timestamp */
  timestamp: number;
}

/**
 * Noise profile learning configuration
 */
export interface NoiseProfilingConfig {
  /** Duration for initial noise sampling (ms) */
  samplingDuration: number;
  /** Minimum samples required for valid profile */
  minSamples: number;
  /** Maximum samples to collect */
  maxSamples: number;
  /** Interval between profile updates during continuous learning (ms) */
  updateInterval: number;
  /** Threshold for detecting significant environment change (0-1) */
  changeThreshold: number;
  /** Enable automatic environment change detection */
  autoDetectChange: boolean;
  /** Enable spectral analysis for better profiling */
  enableSpectralAnalysis: boolean;
  /** FFT size for spectral analysis (power of 2) */
  fftSize: number;
  /** Number of frequency bands for analysis */
  frequencyBands: number;
  /** Smoothing factor for noise floor estimation (0-1) */
  smoothingFactor: number;
  /** Enable persistent storage of profiles */
  enableStorage: boolean;
  /** Storage path for profiles */
  storagePath: string;
}

/**
 * Default noise profiling configuration
 */
export const DEFAULT_NOISE_PROFILING_CONFIG: NoiseProfilingConfig = {
  samplingDuration: 3000,
  minSamples: 50,
  maxSamples: 300,
  updateInterval: 60000,
  changeThreshold: 0.3,
  autoDetectChange: true,
  enableSpectralAnalysis: true,
  fftSize: 512,
  frequencyBands: 8,
  smoothingFactor: 0.95,
  enableStorage: true,
  storagePath: '', // Set at runtime
};

/**
 * Noise profile learning state
 */
export interface NoiseProfileLearningState {
  /** Is currently learning a profile */
  isLearning: boolean;
  /** Learning progress (0-1) */
  progress: number;
  /** Name of profile being learned */
  targetName: string;
  /** Number of samples collected */
  samplesCollected: number;
  /** Target number of samples */
  targetSamples: number;
  /** Time remaining in learning (ms) */
  timeRemaining: number;
}

/**
 * Noise profile manager status
 */
export interface NoiseProfileManagerStatus {
  /** Is manager initialized */
  isInitialized: boolean;
  /** Is currently monitoring */
  isMonitoring: boolean;
  /** Learning state */
  learningState: NoiseProfileLearningState;
  /** Active profile */
  activeProfile: NamedNoiseProfile | null;
  /** Number of stored profiles */
  profileCount: number;
  /** Current noise level indicator */
  noiseLevel: NoiseLevelIndicator | null;
  /** Has environment significantly changed */
  environmentChanged: boolean;
  /** Optimal VAD threshold calculated from profile */
  optimalVADThreshold: number;
  /** Optimal noise gate threshold in dB */
  optimalNoiseGateThreshold: number;
  /** Recommended noise reduction strength (0-1) */
  recommendedNoiseReductionStrength: number;
}

/**
 * Events emitted by noise profile system
 */
export interface NoiseProfileEvents {
  /** Profiling started */
  'profiling-start': () => void;
  /** Profiling progress update */
  'profiling-progress': (progress: number) => void;
  /** Profiling completed */
  'profiling-complete': (profile: NamedNoiseProfile) => void;
  /** Profile switched */
  'profile-switch': (profile: NamedNoiseProfile) => void;
  /** Environment change detected */
  'environment-change': (from: NoiseEnvironmentType, to: NoiseEnvironmentType) => void;
  /** Noise level update (throttled for UI) */
  'noise-level': (indicator: NoiseLevelIndicator) => void;
  /** Profile saved */
  'profile-saved': (profile: NamedNoiseProfile) => void;
  /** Error occurred */
  error: (error: Error) => void;
}

// ============================================================================
// Whisper Mode Types
// ============================================================================

/**
 * Whisper mode configuration
 * Controls discreet/quiet operation mode for Atlas
 */
export interface WhisperModeConfig {
  /** Enable whisper mode */
  enabled: boolean;
  /** Auto-detect whispered speech and respond quietly */
  autoDetect: boolean;
  /** VAD sensitivity for whisper detection (lower = more sensitive) */
  vadSensitivity: number;
  /** Speech probability threshold for whisper (lower than normal) */
  speechThreshold: number;
  /** Minimum RMS level considered as whisper (vs silence) */
  minWhisperRMS: number;
  /** Maximum RMS level for whisper (above = normal speech) */
  maxWhisperRMS: number;
  /** TTS volume level in whisper mode (0-1) */
  ttsVolume: number;
  /** TTS playback speed in whisper mode (slightly faster for discretion) */
  ttsSpeed: number;
  /** Use softer TTS voice characteristics when available */
  useSoftVoice: boolean;
}

/**
 * Default whisper mode configuration
 */
export const DEFAULT_WHISPER_MODE_CONFIG: WhisperModeConfig = {
  enabled: false,
  autoDetect: true,
  vadSensitivity: 0.25, // Lower threshold for whispers
  speechThreshold: 0.3, // Lower than balanced mode's 0.5
  minWhisperRMS: 0.005, // Very quiet speech
  maxWhisperRMS: 0.08, // Transition to normal speech
  ttsVolume: 0.35, // 35% volume for quiet output
  ttsSpeed: 1.1, // Slightly faster for discretion
  useSoftVoice: true,
};

/**
 * Whisper mode state
 */
export type WhisperModeState =
  | 'disabled' // Whisper mode off
  | 'enabled' // Whisper mode manually enabled
  | 'auto_detected' // Whisper detected, auto-enabled
  | 'auto_pending'; // Checking for whisper

/**
 * Whisper mode status
 */
export interface WhisperModeStatus {
  /** Current state */
  state: WhisperModeState;
  /** Is whisper mode currently active */
  isActive: boolean;
  /** Current detected RMS level */
  currentRMS: number;
  /** Was whisper auto-detected */
  wasAutoDetected: boolean;
  /** Timestamp when whisper mode was last activated */
  lastActivatedAt: number;
  /** Timestamp when whisper mode was last deactivated */
  lastDeactivatedAt: number;
  /** Number of auto-detections in current session */
  autoDetectionCount: number;
}

/**
 * Default whisper mode status
 */
export const DEFAULT_WHISPER_MODE_STATUS: WhisperModeStatus = {
  state: 'disabled',
  isActive: false,
  currentRMS: 0,
  wasAutoDetected: false,
  lastActivatedAt: 0,
  lastDeactivatedAt: 0,
  autoDetectionCount: 0,
};

/**
 * Whisper mode events
 */
export interface WhisperModeEvents {
  /** Whisper mode state changed */
  'whisper-mode-changed': (
    enabled: boolean,
    reason: 'manual' | 'auto_detect' | 'voice_command'
  ) => void;
  /** Whisper detected in speech */
  'whisper-detected': (rmsLevel: number, confidence: number) => void;
  /** Normal speech detected (exit whisper) */
  'normal-speech-detected': (rmsLevel: number) => void;
}

/**
 * Voice commands for whisper mode
 */
export const WHISPER_MODE_VOICE_COMMANDS = {
  enable: [
    'whisper mode on',
    'whisper mode',
    'enable whisper mode',
    'quiet mode on',
    'quiet mode',
    'be quiet',
    'speak quietly',
    'shh',
    'shhh',
  ],
  disable: [
    'whisper mode off',
    'disable whisper mode',
    'quiet mode off',
    'disable quiet mode',
    'speak normally',
    'normal mode',
    'normal voice',
  ],
} as const;
