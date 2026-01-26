/**
 * Pyannote Speaker Identification Bridge
 * T5-201 to T5-204: Speaker ID, diarization, embedding extraction, identification
 *
 * Uses Pyannote 3.1 via Python subprocess for:
 * - Speaker diarization (who speaks when)
 * - Voice embedding extraction
 * - Speaker identification (match to enrolled users)
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { PythonShell, Options as PythonOptions } from 'python-shell';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('Pyannote');

// Speaker result from identification
export interface SpeakerResult {
  speakerId: string | null;
  confidence: number;
  isKnown: boolean;
  name?: string;
  segments?: DiarizationSegment[];
}

// Diarization segment (who speaks when)
export interface DiarizationSegment {
  speaker: string;
  start: number;
  end: number;
  confidence: number;
}

// Voice embedding
export interface VoiceEmbedding {
  speakerId: string;
  embedding: Float32Array;
  timestamp: Date;
}

// Enrolled speaker
export interface EnrolledSpeaker {
  id: string;
  name: string;
  enrolledAt: Date;
  sampleCount: number;
  embedding: number[];
}

// Pyannote events
export interface PyannoteEvents {
  initialized: () => void;
  error: (error: Error) => void;
  'speaker:identified': (result: SpeakerResult) => void;
  'speaker:enrolled': (speaker: EnrolledSpeaker) => void;
  'diarization:complete': (segments: DiarizationSegment[]) => void;
}

/**
 * Pyannote Bridge Class
 * Interfaces with Python Pyannote models for speaker identification
 */
export class PyannoteBridge extends EventEmitter {
  private pythonPath: string = 'python';
  private scriptsDir: string;
  private modelsDir: string;
  private speakersPath: string;
  private speakers: Map<string, EnrolledSpeaker> = new Map();
  private isInitialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    super();

    const userDataPath = app?.getPath?.('userData') || path.join(process.env.HOME || '', '.atlas');
    this.scriptsDir = path.join(userDataPath, 'ml', 'scripts');
    this.modelsDir = path.join(userDataPath, 'ml', 'models');
    this.speakersPath = path.join(userDataPath, 'ml', 'speakers.json');

    this.ensureDirectories();
    this.loadSpeakers();
  }

  private ensureDirectories(): void {
    [this.scriptsDir, this.modelsDir].forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Initialize Pyannote models
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      // Create Python initialization script
      await this.createPythonScripts();

      // Test Python and dependencies
      await this.testPython();

      this.isInitialized = true;
      this.emit('initialized');
      logger.info('Pyannote bridge initialized');
    } catch (error) {
      this.emit('error', error as Error);
      logger.error('Failed to initialize Pyannote bridge', { error });
      throw error;
    }
  }

  /**
   * Create Python scripts for Pyannote operations
   */
  private async createPythonScripts(): Promise<void> {
    // Main speaker embedding extraction script
    const embeddingScript = `
"""
Speaker embedding extraction using Pyannote
"""
import sys
import json
import numpy as np
import torch
from pyannote.audio import Model, Inference
from pyannote.audio.pipelines import SpeakerDiarization

# Load embedding model (SpeechBrain ECAPA-TDNN via Pyannote)
EMBEDDING_MODEL = None
DIARIZATION_PIPELINE = None

def load_models(hf_token=None):
    global EMBEDDING_MODEL, DIARIZATION_PIPELINE
    
    if EMBEDDING_MODEL is None:
        EMBEDDING_MODEL = Model.from_pretrained(
            "pyannote/embedding",
            use_auth_token=hf_token
        )
    
    if DIARIZATION_PIPELINE is None:
        DIARIZATION_PIPELINE = SpeakerDiarization.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=hf_token
        )
    
    return True

def extract_embedding(audio_path, hf_token=None):
    """Extract speaker embedding from audio file."""
    load_models(hf_token)
    
    inference = Inference(EMBEDDING_MODEL, window="whole")
    embedding = inference(audio_path)
    
    return embedding.tolist()

def diarize(audio_path, hf_token=None, num_speakers=None):
    """Perform speaker diarization on audio file."""
    load_models(hf_token)
    
    params = {}
    if num_speakers:
        params['num_speakers'] = num_speakers
    
    diarization = DIARIZATION_PIPELINE(audio_path, **params)
    
    segments = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segments.append({
            'speaker': speaker,
            'start': turn.start,
            'end': turn.end,
            'confidence': 1.0  # Pyannote doesn't provide per-segment confidence
        })
    
    return segments

def compare_embeddings(emb1, emb2):
    """Compare two embeddings using cosine similarity."""
    import numpy as np
    
    a = np.array(emb1)
    b = np.array(emb2)
    
    similarity = np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
    return float(similarity)

if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser()
    parser.add_argument('--command', required=True, choices=['embed', 'diarize', 'compare'])
    parser.add_argument('--audio', help='Path to audio file')
    parser.add_argument('--emb1', help='First embedding (JSON)')
    parser.add_argument('--emb2', help='Second embedding (JSON)')
    parser.add_argument('--hf-token', help='HuggingFace token')
    parser.add_argument('--num-speakers', type=int, help='Number of speakers')
    
    args = parser.parse_args()
    
    try:
        if args.command == 'embed':
            result = extract_embedding(args.audio, args.hf_token)
            print(json.dumps({'success': True, 'embedding': result}))
        
        elif args.command == 'diarize':
            result = diarize(args.audio, args.hf_token, args.num_speakers)
            print(json.dumps({'success': True, 'segments': result}))
        
        elif args.command == 'compare':
            emb1 = json.loads(args.emb1)
            emb2 = json.loads(args.emb2)
            similarity = compare_embeddings(emb1, emb2)
            print(json.dumps({'success': True, 'similarity': similarity}))
    
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)
`;

    fs.writeFileSync(path.join(this.scriptsDir, 'pyannote_speaker.py'), embeddingScript);
    logger.info('Python scripts created');
  }

  /**
   * Test Python installation
   */
  private async testPython(): Promise<void> {
    try {
      await PythonShell.run('-c', { pythonPath: this.pythonPath, args: ['print("ok")'] });
    } catch (err) {
      throw new Error(`Python not available: ${(err as Error).message}`);
    }
  }

  /**
   * Extract voice embedding from audio
   */
  async extractEmbedding(audioPath: string): Promise<number[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    const hfToken = process.env.HUGGINGFACE_TOKEN || '';

    const options: PythonOptions = {
      pythonPath: this.pythonPath,
      scriptPath: this.scriptsDir,
      args: ['--command', 'embed', '--audio', audioPath, '--hf-token', hfToken],
    };

    const results = await PythonShell.run('pyannote_speaker.py', options);
    const result = JSON.parse(results?.[results.length - 1] || '{}');
    if (result.success) {
      return result.embedding;
    } else {
      throw new Error(result.error || 'Unknown error');
    }
  }

  /**
   * Perform speaker diarization
   */
  async diarize(audioPath: string, numSpeakers?: number): Promise<DiarizationSegment[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    const hfToken = process.env.HUGGINGFACE_TOKEN || '';
    const args = ['--command', 'diarize', '--audio', audioPath, '--hf-token', hfToken];

    if (numSpeakers) {
      args.push('--num-speakers', String(numSpeakers));
    }

    const options: PythonOptions = {
      pythonPath: this.pythonPath,
      scriptPath: this.scriptsDir,
      args,
    };

    const results = await PythonShell.run('pyannote_speaker.py', options);
    const result = JSON.parse(results?.[results.length - 1] || '{}');
    if (result.success) {
      this.emit('diarization:complete', result.segments);
      return result.segments;
    } else {
      throw new Error(result.error || 'Unknown error');
    }
  }

  /**
   * Compare two embeddings (cosine similarity)
   */
  async compareEmbeddings(emb1: number[], emb2: number[]): Promise<number> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const options: PythonOptions = {
      pythonPath: this.pythonPath,
      scriptPath: this.scriptsDir,
      args: [
        '--command',
        'compare',
        '--emb1',
        JSON.stringify(emb1),
        '--emb2',
        JSON.stringify(emb2),
      ],
    };

    const results = await PythonShell.run('pyannote_speaker.py', options);
    const result = JSON.parse(results?.[results.length - 1] || '{}');
    if (result.success) {
      return result.similarity;
    } else {
      throw new Error(result.error || 'Unknown error');
    }
  }

  /**
   * Identify speaker from audio
   */
  async identifySpeaker(audioPath: string, threshold: number = 0.7): Promise<SpeakerResult> {
    const embedding = await this.extractEmbedding(audioPath);

    let bestMatch: EnrolledSpeaker | null = null;
    let bestScore = 0;

    for (const speaker of this.speakers.values()) {
      const similarity = await this.compareEmbeddings(embedding, speaker.embedding);

      if (similarity > bestScore) {
        bestScore = similarity;
        bestMatch = speaker;
      }
    }

    const result: SpeakerResult = {
      speakerId: bestMatch && bestScore >= threshold ? bestMatch.id : null,
      confidence: bestScore,
      isKnown: bestMatch !== null && bestScore >= threshold,
      name: bestMatch && bestScore >= threshold ? bestMatch.name : undefined,
    };

    this.emit('speaker:identified', result);
    logger.info('Speaker identification complete', {
      isKnown: result.isKnown,
      confidence: result.confidence,
      name: result.name,
    });

    return result;
  }

  /**
   * Enroll a new speaker
   */
  async enrollSpeaker(name: string, audioSamples: string[]): Promise<EnrolledSpeaker> {
    if (audioSamples.length === 0) {
      throw new Error('At least one audio sample required for enrollment');
    }

    // Extract embeddings from all samples
    const embeddings: number[][] = [];
    for (const sample of audioSamples) {
      const embedding = await this.extractEmbedding(sample);
      embeddings.push(embedding);
    }

    // Average the embeddings
    const averagedEmbedding = this.averageEmbeddings(embeddings);

    const speaker: EnrolledSpeaker = {
      id: `speaker_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name,
      enrolledAt: new Date(),
      sampleCount: audioSamples.length,
      embedding: averagedEmbedding,
    };

    this.speakers.set(speaker.id, speaker);
    this.saveSpeakers();

    this.emit('speaker:enrolled', speaker);
    logger.info('Speaker enrolled', { id: speaker.id, name, samples: audioSamples.length });

    return speaker;
  }

  /**
   * Update speaker with additional samples
   */
  async updateSpeaker(speakerId: string, additionalSamples: string[]): Promise<EnrolledSpeaker> {
    const speaker = this.speakers.get(speakerId);
    if (!speaker) {
      throw new Error(`Speaker not found: ${speakerId}`);
    }

    // Extract new embeddings
    const newEmbeddings: number[][] = [];
    for (const sample of additionalSamples) {
      const embedding = await this.extractEmbedding(sample);
      newEmbeddings.push(embedding);
    }

    // Combine with existing embedding (weighted average)
    const allEmbeddings = [speaker.embedding, ...newEmbeddings];
    const weights = [speaker.sampleCount, ...newEmbeddings.map(() => 1)];
    const updatedEmbedding = this.weightedAverageEmbeddings(allEmbeddings, weights);

    speaker.embedding = updatedEmbedding;
    speaker.sampleCount += additionalSamples.length;

    this.speakers.set(speakerId, speaker);
    this.saveSpeakers();

    logger.info('Speaker updated', { id: speakerId, newSamples: additionalSamples.length });
    return speaker;
  }

  /**
   * Delete a speaker
   */
  deleteSpeaker(speakerId: string): boolean {
    const deleted = this.speakers.delete(speakerId);
    if (deleted) {
      this.saveSpeakers();
      logger.info('Speaker deleted', { id: speakerId });
    }
    return deleted;
  }

  /**
   * Get all enrolled speakers
   */
  getSpeakers(): EnrolledSpeaker[] {
    return Array.from(this.speakers.values());
  }

  /**
   * Get speaker by ID
   */
  getSpeaker(speakerId: string): EnrolledSpeaker | undefined {
    return this.speakers.get(speakerId);
  }

  /**
   * Get speaker by name
   */
  getSpeakerByName(name: string): EnrolledSpeaker | undefined {
    return Array.from(this.speakers.values()).find(
      (s) => s.name.toLowerCase() === name.toLowerCase()
    );
  }

  /**
   * Average multiple embeddings
   */
  private averageEmbeddings(embeddings: number[][]): number[] {
    if (embeddings.length === 0) return [];

    const dim = embeddings[0].length;
    const result = new Array(dim).fill(0);

    for (const emb of embeddings) {
      for (let i = 0; i < dim; i++) {
        result[i] += emb[i];
      }
    }

    for (let i = 0; i < dim; i++) {
      result[i] /= embeddings.length;
    }

    return result;
  }

  /**
   * Weighted average of embeddings
   */
  private weightedAverageEmbeddings(embeddings: number[][], weights: number[]): number[] {
    if (embeddings.length === 0) return [];

    const dim = embeddings[0].length;
    const result = new Array(dim).fill(0);
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    for (let e = 0; e < embeddings.length; e++) {
      for (let i = 0; i < dim; i++) {
        result[i] += embeddings[e][i] * weights[e];
      }
    }

    for (let i = 0; i < dim; i++) {
      result[i] /= totalWeight;
    }

    return result;
  }

  /**
   * Load enrolled speakers from disk
   */
  private loadSpeakers(): void {
    try {
      if (fs.existsSync(this.speakersPath)) {
        const data = JSON.parse(fs.readFileSync(this.speakersPath, 'utf-8'));
        for (const speaker of data.speakers || []) {
          speaker.enrolledAt = new Date(speaker.enrolledAt);
          this.speakers.set(speaker.id, speaker);
        }
        logger.info('Loaded enrolled speakers', { count: this.speakers.size });
      }
    } catch (error) {
      logger.error('Failed to load speakers', { error });
    }
  }

  /**
   * Save enrolled speakers to disk
   */
  private saveSpeakers(): void {
    try {
      const data = {
        speakers: Array.from(this.speakers.values()),
        lastUpdated: new Date().toISOString(),
      };
      fs.writeFileSync(this.speakersPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save speakers', { error });
    }
  }

  /**
   * Check if Pyannote is properly configured
   */
  isConfigured(): boolean {
    return !!process.env.HUGGINGFACE_TOKEN;
  }

  /**
   * Set Python path
   */
  setPythonPath(pythonPath: string): void {
    this.pythonPath = pythonPath;
  }
}

// Singleton instance
let pyannoteBridge: PyannoteBridge | null = null;

/**
 * Get or create the Pyannote bridge instance
 */
export function getPyannoteBridge(): PyannoteBridge {
  if (!pyannoteBridge) {
    pyannoteBridge = new PyannoteBridge();
  }
  return pyannoteBridge;
}
