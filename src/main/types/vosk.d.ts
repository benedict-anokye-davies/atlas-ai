/**
 * Type definitions for vosk-koffi
 * Based on the Vosk speech recognition library API
 */

declare module 'vosk-koffi' {
  /**
   * Set Vosk log level
   * @param level 0 = errors only, 1 = warnings, 2 = info, 3 = debug
   */
  export function setLogLevel(level: number): void;

  /**
   * Vosk Speech Recognition Model
   * Must be loaded from a directory containing the model files
   */
  export class Model {
    /**
     * Create a new Model instance
     * @param modelPath Path to the directory containing the Vosk model
     */
    constructor(modelPath: string);

    /**
     * Free model resources
     * Should be called when the model is no longer needed
     */
    free(): void;
  }

  /**
   * Speaker Model for speaker identification
   */
  export class SpkModel {
    /**
     * Create a new Speaker Model instance
     * @param modelPath Path to the speaker model directory
     */
    constructor(modelPath: string);

    /**
     * Free speaker model resources
     */
    free(): void;
  }

  /**
   * Configuration options for the Recognizer
   */
  export interface RecognizerConfig {
    /** The main recognition model */
    model: Model;
    /** Sample rate in Hz (typically 16000) */
    sampleRate: number;
    /** Optional speaker model for speaker identification */
    spkModel?: SpkModel;
    /** Optional grammar (JSON array of words) */
    grammar?: string[];
  }

  /**
   * Word result from recognition
   */
  export interface WordResult {
    /** The recognized word */
    word: string;
    /** Start time in seconds */
    start: number;
    /** End time in seconds */
    end: number;
    /** Confidence score (0-1) */
    conf: number;
  }

  /**
   * Recognition result structure
   */
  export interface RecognitionResult {
    /** Recognized text (for final results) */
    text?: string;
    /** Partial text (for interim results) */
    partial?: string;
    /** Array of word-level results */
    result?: WordResult[];
    /** Speaker vector (if spkModel was provided) */
    spk?: number[];
    /** Speaker frames */
    spk_frames?: number;
  }

  /**
   * Alternative recognition result
   */
  export interface AlternativeResult {
    /** Recognized text */
    text: string;
    /** Confidence score */
    confidence: number;
  }

  /**
   * Result with alternatives
   */
  export interface ResultWithAlternatives {
    alternatives: AlternativeResult[];
  }

  /**
   * Vosk Speech Recognizer
   * Processes audio data and produces transcriptions
   */
  export class Recognizer {
    /**
     * Create a new Recognizer instance
     * @param config Configuration options
     */
    constructor(config: RecognizerConfig);

    /**
     * Enable word-level timestamps in results
     * @param words Whether to include word timestamps
     */
    setWords(words: boolean): void;

    /**
     * Enable alternative results
     * @param maxAlternatives Maximum number of alternatives to return
     */
    setMaxAlternatives(maxAlternatives: number): void;

    /**
     * Set speaker model for speaker identification
     * @param spkModel Speaker model instance
     */
    setSpkModel(spkModel: SpkModel): void;

    /**
     * Set partial result mode
     * @param partial Whether to enable partial results
     */
    setPartialWords(partial: boolean): void;

    /**
     * Set NLSML output format
     * @param nlsml Whether to use NLSML format
     */
    setNLSML(nlsml: boolean): void;

    /**
     * Process audio data
     * @param data Audio samples as Int16Array (16-bit PCM)
     * @returns true if an utterance is complete, false otherwise
     */
    acceptWaveform(data: Int16Array): boolean;

    /**
     * Process audio data from a Buffer
     * @param data Audio samples as Buffer (16-bit PCM, little-endian)
     * @returns true if an utterance is complete, false otherwise
     */
    acceptWaveformAsync(data: Buffer): Promise<boolean>;

    /**
     * Get the current result (final for completed utterance)
     * @returns JSON string containing recognition result
     */
    result(): string;

    /**
     * Get the partial (interim) result
     * @returns JSON string containing partial recognition result
     */
    partialResult(): string;

    /**
     * Get the final result and reset the recognizer
     * @returns JSON string containing final recognition result
     */
    finalResult(): string;

    /**
     * Reset the recognizer state for a new utterance
     */
    reset(): void;

    /**
     * Free recognizer resources
     * Should be called when the recognizer is no longer needed
     */
    free(): void;
  }

  /**
   * GPU-accelerated Model (if available)
   */
  export class GpuModel {
    constructor(modelPath: string);
    free(): void;
  }

  /**
   * Batch recognizer for processing multiple utterances
   */
  export class BatchModel {
    constructor(modelPath: string);
    free(): void;
    wait(): void;
  }

  /**
   * Batch recognizer instance
   */
  export class BatchRecognizer {
    constructor(model: BatchModel, sampleRate: number);
    setWords(words: boolean): void;
    setNLSML(nlsml: boolean): void;
    setMaxAlternatives(maxAlternatives: number): void;
    acceptWaveform(data: Int16Array): void;
    result(): string;
    finalResult(): string;
    pendingChunks(): number;
    free(): void;
  }
}
