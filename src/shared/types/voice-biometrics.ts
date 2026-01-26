/**
 * Atlas Voice Biometrics Types
 * Types for voice identification and user recognition
 */

// ============================================================================
// Voice Embedding Types
// ============================================================================

/**
 * Voice embedding vector extracted from audio
 * Represents acoustic features that are unique to a speaker
 */
export interface VoiceEmbedding {
  /** 192-dimensional embedding vector (ECAPA-TDNN standard) */
  vector: Float32Array;
  /** Duration of audio used to generate embedding (ms) */
  audioDurationMs: number;
  /** Timestamp when embedding was created */
  timestamp: number;
  /** Quality score of the embedding (0-1) */
  qualityScore: number;
  /** Sample rate of source audio */
  sampleRate: number;
}

/**
 * Voice embedding extraction configuration
 */
export interface EmbeddingExtractionConfig {
  /** Minimum audio duration required for embedding (ms) */
  minAudioDurationMs: number;
  /** Maximum audio duration to process (ms) */
  maxAudioDurationMs: number;
  /** Minimum quality score to accept embedding */
  minQualityScore: number;
  /** Enable voice activity detection pre-filtering */
  enableVAD: boolean;
  /** Target sample rate for processing */
  targetSampleRate: number;
  /** Frame size for feature extraction */
  frameSize: number;
  /** Hop size for feature extraction */
  hopSize: number;
}

/**
 * Default embedding extraction configuration
 */
export const DEFAULT_EMBEDDING_CONFIG: EmbeddingExtractionConfig = {
  minAudioDurationMs: 1000,
  maxAudioDurationMs: 30000,
  minQualityScore: 0.6,
  enableVAD: true,
  targetSampleRate: 16000,
  frameSize: 400, // 25ms at 16kHz
  hopSize: 160, // 10ms at 16kHz
};

// ============================================================================
// Voiceprint Types
// ============================================================================

/**
 * A voiceprint is a template created from multiple voice samples
 * Used for speaker identification/verification
 */
export interface Voiceprint {
  /** Unique identifier for this voiceprint */
  id: string;
  /** User ID this voiceprint belongs to */
  userId: string;
  /** Display name for the user */
  userName: string;
  /** Averaged embedding vector from enrollment samples */
  embedding: Float32Array;
  /** Individual enrollment embeddings for variance calculation */
  enrollmentEmbeddings: VoiceEmbedding[];
  /** Number of samples used to create this voiceprint */
  sampleCount: number;
  /** Intra-speaker variance (for threshold adaptation) */
  variance: number;
  /** Quality score of the voiceprint (0-1) */
  qualityScore: number;
  /** Timestamp when voiceprint was created */
  createdAt: number;
  /** Timestamp when voiceprint was last updated */
  updatedAt: number;
  /** Whether this voiceprint is active */
  isActive: boolean;
  /** Metadata */
  metadata?: VoiceprintMetadata;
}

/**
 * Voiceprint metadata
 */
export interface VoiceprintMetadata {
  /** Device used for enrollment */
  enrollmentDevice?: string;
  /** Environment during enrollment (quiet, noisy) */
  enrollmentEnvironment?: string;
  /** Notes about this user */
  notes?: string;
  /** Custom tags */
  tags?: string[];
}

/**
 * Serializable voiceprint for storage
 */
export interface SerializedVoiceprint {
  id: string;
  userId: string;
  userName: string;
  /** Base64-encoded embedding */
  embedding: string;
  /** Base64-encoded enrollment embeddings */
  enrollmentEmbeddings: SerializedEmbedding[];
  sampleCount: number;
  variance: number;
  qualityScore: number;
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
  metadata?: VoiceprintMetadata;
}

/**
 * Serializable embedding for storage
 */
export interface SerializedEmbedding {
  /** Base64-encoded vector */
  vector: string;
  audioDurationMs: number;
  timestamp: number;
  qualityScore: number;
  sampleRate: number;
}

// ============================================================================
// User Profile Types
// ============================================================================

/**
 * Voice user profile with voiceprint and preferences
 */
export interface VoiceUserProfile {
  /** Unique user identifier */
  id: string;
  /** Display name */
  name: string;
  /** Email (optional, for multi-user scenarios) */
  email?: string;
  /** Associated voiceprint */
  voiceprint?: Voiceprint;
  /** User-specific preferences */
  preferences: VoiceUserPreferences;
  /** Creation timestamp */
  createdAt: number;
  /** Last identification timestamp */
  lastIdentifiedAt?: number;
  /** Total number of successful identifications */
  identificationCount: number;
  /** Is this the primary/owner user */
  isPrimary: boolean;
  /** Profile status */
  status: UserProfileStatus;
}

/**
 * User-specific voice preferences
 */
export interface VoiceUserPreferences {
  /** Preferred TTS voice for this user */
  preferredVoice?: string;
  /** Custom greeting for this user */
  customGreeting?: string;
  /** Preferred response style */
  responseStyle?: 'concise' | 'detailed' | 'casual' | 'formal';
  /** Enable personalized responses */
  enablePersonalization: boolean;
}

/**
 * User profile status
 */
export type UserProfileStatus = 'active' | 'inactive' | 'pending_enrollment' | 'suspended';

// ============================================================================
// Enrollment Types
// ============================================================================

/**
 * Voice enrollment session
 */
export interface EnrollmentSession {
  /** Session identifier */
  sessionId: string;
  /** User ID being enrolled */
  userId: string;
  /** User name */
  userName: string;
  /** Current enrollment stage */
  stage: EnrollmentStage;
  /** Collected voice samples */
  samples: EnrollmentSample[];
  /** Number of samples required */
  requiredSamples: number;
  /** Session start time */
  startedAt: number;
  /** Session timeout (ms) */
  timeoutMs: number;
  /** Current status */
  status: EnrollmentStatus;
  /** Error message if failed */
  errorMessage?: string;
}

/**
 * Individual enrollment sample
 */
export interface EnrollmentSample {
  /** Sample index (1-based) */
  index: number;
  /** Audio data */
  audio: Float32Array;
  /** Duration (ms) */
  durationMs: number;
  /** Extracted embedding */
  embedding?: VoiceEmbedding;
  /** Quality score */
  qualityScore: number;
  /** Timestamp */
  timestamp: number;
  /** Prompt text shown to user */
  promptText: string;
  /** Whether sample passed validation */
  isValid: boolean;
  /** Validation error if invalid */
  validationError?: string;
}

/**
 * Enrollment stage
 */
export type EnrollmentStage =
  | 'not_started'
  | 'collecting_samples'
  | 'processing'
  | 'validating'
  | 'completed'
  | 'failed';

/**
 * Enrollment status
 */
export type EnrollmentStatus =
  | 'idle'
  | 'waiting_for_speech'
  | 'recording'
  | 'processing_sample'
  | 'sample_accepted'
  | 'sample_rejected'
  | 'finalizing'
  | 'success'
  | 'error';

/**
 * Enrollment progress update
 */
export interface EnrollmentProgress {
  sessionId: string;
  stage: EnrollmentStage;
  status: EnrollmentStatus;
  currentSample: number;
  totalSamples: number;
  progressPercent: number;
  message: string;
  promptText?: string;
}

/**
 * Enrollment result
 */
export interface EnrollmentResult {
  success: boolean;
  voiceprint?: Voiceprint;
  error?: string;
  qualityScore: number;
  samplesCollected: number;
  processingTimeMs: number;
}

/**
 * Enrollment configuration
 */
export interface EnrollmentConfig {
  /** Number of voice samples required */
  requiredSamples: number;
  /** Minimum duration per sample (ms) */
  minSampleDurationMs: number;
  /** Maximum duration per sample (ms) */
  maxSampleDurationMs: number;
  /** Minimum quality score for sample acceptance */
  minSampleQuality: number;
  /** Maximum variance between samples for consistency check */
  maxSampleVariance: number;
  /** Session timeout (ms) */
  sessionTimeoutMs: number;
  /** Enable real-time feedback */
  enableRealTimeFeedback: boolean;
  /** Prompts to display during enrollment */
  enrollmentPrompts: string[];
}

/**
 * Default enrollment configuration
 */
export const DEFAULT_ENROLLMENT_CONFIG: EnrollmentConfig = {
  requiredSamples: 3,
  minSampleDurationMs: 2000,
  maxSampleDurationMs: 10000,
  minSampleQuality: 0.5,
  maxSampleVariance: 0.3,
  sessionTimeoutMs: 300000, // 5 minutes
  enableRealTimeFeedback: true,
  enrollmentPrompts: [
    'Please say: "Atlas, my voice is my password"',
    'Please say: "Hello Atlas, how are you today?"',
    'Please say: "I am enrolling my voice for identification"',
  ],
};

// ============================================================================
// Identification Types
// ============================================================================

/**
 * Voice identification result
 */
export interface IdentificationResult {
  /** Whether identification was successful */
  identified: boolean;
  /** Matched user profile (if identified) */
  user?: VoiceUserProfile;
  /** Confidence score (0-1) */
  confidence: number;
  /** All scores for enrolled users */
  scores: IdentificationScore[];
  /** Processing latency (ms) */
  latencyMs: number;
  /** Quality of input audio */
  audioQuality: number;
  /** Reason if not identified */
  reason?: IdentificationFailureReason;
}

/**
 * Score for a single enrolled user
 */
export interface IdentificationScore {
  userId: string;
  userName: string;
  /** Cosine similarity score (0-1) */
  similarity: number;
  /** Whether score meets threshold */
  meetsThreshold: boolean;
}

/**
 * Reasons for identification failure
 */
export type IdentificationFailureReason =
  | 'no_enrolled_users'
  | 'audio_too_short'
  | 'audio_quality_low'
  | 'no_speech_detected'
  | 'below_threshold'
  | 'multiple_matches'
  | 'processing_error';

/**
 * Voice identification configuration
 */
export interface IdentificationConfig {
  /** Minimum confidence threshold for positive identification */
  confidenceThreshold: number;
  /** Minimum margin between top two scores */
  minMargin: number;
  /** Minimum audio duration (ms) */
  minAudioDurationMs: number;
  /** Maximum audio duration to process (ms) */
  maxAudioDurationMs: number;
  /** Minimum audio quality score */
  minAudioQuality: number;
  /** Enable adaptive thresholding based on voiceprint variance */
  adaptiveThreshold: boolean;
  /** Enable continuous identification during conversation */
  continuousIdentification: boolean;
  /** Re-identification interval (ms) */
  reidentificationIntervalMs: number;
}

/**
 * Default identification configuration
 */
export const DEFAULT_IDENTIFICATION_CONFIG: IdentificationConfig = {
  confidenceThreshold: 0.65,
  minMargin: 0.1,
  minAudioDurationMs: 1000,
  maxAudioDurationMs: 10000,
  minAudioQuality: 0.4,
  adaptiveThreshold: true,
  continuousIdentification: false,
  reidentificationIntervalMs: 30000,
};

// ============================================================================
// Voice ID Manager Events
// ============================================================================

/**
 * Voice ID system events
 */
export interface VoiceIdEvents {
  /** User identified */
  'user-identified': (result: IdentificationResult) => void;
  /** User not recognized */
  'user-unknown': (result: IdentificationResult) => void;
  /** Enrollment progress */
  'enrollment-progress': (progress: EnrollmentProgress) => void;
  /** Enrollment completed */
  'enrollment-complete': (result: EnrollmentResult) => void;
  /** Voiceprint updated */
  'voiceprint-updated': (voiceprint: Voiceprint) => void;
  /** Error occurred */
  'error': (error: Error, context: string) => void;
}

// ============================================================================
// Storage Types
// ============================================================================

/**
 * Voiceprint storage interface
 */
export interface VoiceprintStore {
  /** Get all voiceprints */
  getAll(): Promise<Voiceprint[]>;
  /** Get voiceprint by ID */
  getById(id: string): Promise<Voiceprint | null>;
  /** Get voiceprint by user ID */
  getByUserId(userId: string): Promise<Voiceprint | null>;
  /** Save voiceprint */
  save(voiceprint: Voiceprint): Promise<void>;
  /** Delete voiceprint */
  delete(id: string): Promise<void>;
  /** Clear all voiceprints */
  clear(): Promise<void>;
}

/**
 * User profile storage interface
 */
export interface UserProfileStore {
  /** Get all profiles */
  getAll(): Promise<VoiceUserProfile[]>;
  /** Get profile by ID */
  getById(id: string): Promise<VoiceUserProfile | null>;
  /** Get primary user profile */
  getPrimary(): Promise<VoiceUserProfile | null>;
  /** Save profile */
  save(profile: VoiceUserProfile): Promise<void>;
  /** Delete profile */
  delete(id: string): Promise<void>;
  /** Update last identified time */
  updateLastIdentified(id: string, timestamp: number): Promise<void>;
}
