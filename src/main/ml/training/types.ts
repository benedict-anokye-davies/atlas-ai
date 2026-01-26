/**
 * Atlas ML Training - Type Definitions
 *
 * Types for training data collection, labeling, and dataset management.
 *
 * @module ml/training/types
 */

// =============================================================================
// Dataset Types
// =============================================================================

/**
 * Types of datasets we can collect
 */
export type DatasetType =
  | 'conversation' // User-assistant conversations for fine-tuning
  | 'voice' // Voice samples for speaker ID / wake word
  | 'trading' // OHLCV data for LSTM prediction
  | 'emotion' // Labeled emotion samples
  | 'preference'; // User preference patterns

/**
 * Export formats for datasets
 */
export type ExportFormat =
  | 'jsonl' // JSON Lines (for LLM fine-tuning)
  | 'csv' // CSV (for tabular data)
  | 'parquet' // Parquet (for large datasets)
  | 'hf' // Hugging Face Datasets format
  | 'wav'; // WAV audio files (zipped)

/**
 * Dataset statistics
 */
export interface DatasetStats {
  type: DatasetType;
  totalSamples: number;
  labeledSamples: number;
  unlabeledSamples: number;
  sizeBytes: number;
  createdAt: number;
  updatedAt: number;
  labels?: Record<string, number>;
}

// =============================================================================
// Conversation Data Types
// =============================================================================

/**
 * A single conversation sample for LLM fine-tuning
 */
export interface ConversationSample {
  id: string;
  timestamp: number;
  /** User's input message */
  userMessage: string;
  /** Assistant's response */
  assistantResponse: string;
  /** System prompt used (if any) */
  systemPrompt?: string;
  /** Topic/category of conversation */
  topics: string[];
  /** Quality rating (1-5, for filtering) */
  quality?: number;
  /** Whether user corrected the response */
  wasCorrection?: boolean;
  /** Original response if corrected */
  originalResponse?: string;
  /** Tool calls made during response */
  toolCalls?: ToolCallRecord[];
  /** Response latency in ms */
  latencyMs?: number;
  /** User satisfaction signal */
  userSatisfaction?: 'positive' | 'negative' | 'neutral';
}

/**
 * Tool call record for training
 */
export interface ToolCallRecord {
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  success: boolean;
  durationMs: number;
}

/**
 * Conversation dataset in JSONL format (OpenAI/Fireworks compatible)
 */
export interface ConversationTrainingRow {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
}

// =============================================================================
// Voice Sample Types
// =============================================================================

/**
 * A voice sample for speaker ID or wake word training
 */
export interface VoiceSample {
  id: string;
  timestamp: number;
  /** Path to audio file */
  audioPath: string;
  /** Duration in seconds */
  durationSeconds: number;
  /** Sample rate (usually 16000) */
  sampleRate: number;
  /** Speaker ID (if labeled) */
  speakerId?: string;
  /** Speaker name (if known) */
  speakerName?: string;
  /** Transcript (if STT was run) */
  transcript?: string;
  /** Is this a wake word sample? */
  isWakeWord?: boolean;
  /** Wake word phrase (if applicable) */
  wakeWordPhrase?: string;
  /** Emotion label (if labeled) */
  emotion?: EmotionLabel;
  /** Audio quality (1-5) */
  quality?: number;
  /** Noise level estimate (0-1) */
  noiseLevel?: number;
}

/**
 * Emotion labels for voice samples
 */
export type EmotionLabel =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'fearful'
  | 'disgusted'
  | 'surprised';

// =============================================================================
// Trading Data Types
// =============================================================================

/**
 * OHLCV data point for LSTM training
 */
export interface TradingDataPoint {
  timestamp: number;
  symbol: string;
  exchange: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Technical indicators (optional) */
  indicators?: TechnicalIndicators;
}

/**
 * Technical indicators for feature engineering
 */
export interface TechnicalIndicators {
  sma20?: number;
  sma50?: number;
  sma200?: number;
  ema12?: number;
  ema26?: number;
  rsi14?: number;
  macd?: number;
  macdSignal?: number;
  macdHistogram?: number;
  bollingerUpper?: number;
  bollingerMiddle?: number;
  bollingerLower?: number;
  atr14?: number;
  obv?: number;
  vwap?: number;
}

/**
 * Training data for LSTM model
 */
export interface TradingTrainingSample {
  /** Input features (sequence of normalized OHLCV + indicators) */
  features: number[][];
  /** Target (next candle's close or direction) */
  target: number | number[];
  /** Metadata */
  metadata: {
    symbol: string;
    exchange: string;
    timeframe: string;
    startTime: number;
    endTime: number;
  };
}

// =============================================================================
// Labeling Types
// =============================================================================

/**
 * Label types for semi-automatic labeling
 */
export type LabelType =
  | 'quality' // Conversation quality (1-5)
  | 'topic' // Topic classification
  | 'emotion' // Emotion classification
  | 'speaker' // Speaker identification
  | 'sentiment' // Sentiment (positive/negative/neutral)
  | 'intent'; // User intent classification

/**
 * A labeling task
 */
export interface LabelingTask {
  id: string;
  sampleId: string;
  sampleType: DatasetType;
  labelType: LabelType;
  /** Auto-suggested label */
  suggestedLabel?: string | number;
  /** Confidence of auto-suggestion (0-1) */
  confidence?: number;
  /** Manually applied label */
  appliedLabel?: string | number;
  /** Who applied the label */
  labeledBy?: 'auto' | 'user' | 'model';
  /** When labeled */
  labeledAt?: number;
  status: 'pending' | 'labeled' | 'skipped' | 'needs_review';
}

// =============================================================================
// Collection Configuration
// =============================================================================

/**
 * Configuration for data collection
 */
export interface CollectionConfig {
  /** Enable conversation collection */
  collectConversations: boolean;
  /** Enable voice sample collection */
  collectVoice: boolean;
  /** Enable trading data collection */
  collectTrading: boolean;
  /** Minimum quality threshold for auto-inclusion */
  minQuality: number;
  /** Maximum samples to keep per dataset */
  maxSamples: number;
  /** Auto-label using LLM */
  autoLabel: boolean;
  /** Storage path for datasets */
  storagePath: string;
}

/**
 * Default collection configuration
 */
export const DEFAULT_COLLECTION_CONFIG: CollectionConfig = {
  collectConversations: true,
  collectVoice: true,
  collectTrading: true,
  minQuality: 3,
  maxSamples: 100000,
  autoLabel: true,
  storagePath: '', // Set at runtime to ~/.atlas/training-data
};

// =============================================================================
// Export Types
// =============================================================================

/**
 * Export options
 */
export interface ExportOptions {
  type: DatasetType;
  format: ExportFormat;
  /** Filter by quality (min) */
  minQuality?: number;
  /** Filter by date range */
  since?: number;
  until?: number;
  /** Only include labeled samples */
  labeledOnly?: boolean;
  /** Shuffle samples */
  shuffle?: boolean;
  /** Train/val/test split ratios */
  split?: {
    train: number;
    validation: number;
    test: number;
  };
  /** Output directory */
  outputPath: string;
}

/**
 * Export result
 */
export interface ExportResult {
  type: DatasetType;
  format: ExportFormat;
  outputPath: string;
  totalSamples: number;
  splits?: {
    train: string;
    validation: string;
    test: string;
  };
  sizeBytes: number;
  exportedAt: number;
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Training data events
 */
export interface TrainingDataEvents {
  'sample-collected': (sample: ConversationSample | VoiceSample | TradingDataPoint) => void;
  'dataset-updated': (stats: DatasetStats) => void;
  'export-complete': (result: ExportResult) => void;
  'label-applied': (task: LabelingTask) => void;
  error: (error: Error) => void;
}
