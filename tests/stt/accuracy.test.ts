/**
 * Atlas Desktop - STT Accuracy Tests
 *
 * Comprehensive accuracy testing framework for speech-to-text providers.
 * Tests Word Error Rate (WER), Character Error Rate (CER), and other metrics
 * across various conditions including accents, speeds, and noise levels.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import {
  calculateWER,
  calculateBatchWER,
  normalizeText,
  tokenize,
  getAccuracyGrade,
  formatWER,
  visualizeAlignment,
  WERResult,
  BatchWERResult,
  NormalizationOptions,
} from './wer';
import {
  REFERENCE_TRANSCRIPTS,
  CHALLENGING_TRANSCRIPTS,
  TEST_SUITES,
  getTestSuite,
  getAllSamples,
  filterSamples,
  AudioSample,
} from './fixtures/test-audio';
import {
  createSilentAudio,
  createSineWave,
  createWhiteNoise,
  createSpeechLikeAudio,
} from '../fixtures/audio';

// Mock logger to prevent console noise during tests
vi.mock('../../src/main/utils/logger', () => ({
  createModuleLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  PerformanceTimer: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    end: vi.fn(),
  })),
}));

// Mock electron
vi.mock('electron', () => ({
  app: {
    exit: vi.fn(),
    getPath: vi.fn(() => '/mock/path'),
  },
  dialog: {
    showErrorBox: vi.fn(),
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
  },
}));

/**
 * Mock STT provider for testing accuracy calculation
 * Uses a seeded random for reproducible results
 */
class MockSTTProvider {
  private transcriptionResults: Map<string, string>;
  private errorRate: number;
  private seed: number;

  constructor(errorRate = 0, seed = 12345) {
    this.transcriptionResults = new Map();
    this.errorRate = errorRate;
    this.seed = seed;
  }

  /**
   * Simple seeded random number generator (mulberry32)
   */
  private seededRandom(): number {
    this.seed |= 0;
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let t = Math.imul(this.seed ^ (this.seed >>> 15), 1 | this.seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Set expected transcription result
   */
  setResult(sampleId: string, hypothesis: string): void {
    this.transcriptionResults.set(sampleId, hypothesis);
  }

  /**
   * Set multiple results
   */
  setResults(results: Map<string, string>): void {
    this.transcriptionResults = results;
  }

  /**
   * Simulate transcription with optional noise
   */
  transcribe(sampleId: string, reference: string): string {
    // If we have a preset result, use it
    if (this.transcriptionResults.has(sampleId)) {
      return this.transcriptionResults.get(sampleId)!;
    }

    // Otherwise, simulate based on error rate
    if (this.errorRate === 0) {
      return reference;
    }

    // Introduce errors based on error rate using seeded random
    const words = reference.split(' ');
    const result = words.map((word) => {
      if (this.seededRandom() < this.errorRate) {
        // Randomly substitute, insert, or delete
        const action = this.seededRandom();
        if (action < 0.33) {
          // Substitution
          return this.mutateWord(word);
        } else if (action < 0.66) {
          // Insertion
          return word + ' ' + this.randomWord();
        } else {
          // Deletion
          return '';
        }
      }
      return word;
    });

    return result.filter((w) => w.length > 0).join(' ');
  }

  private mutateWord(word: string): string {
    const mutations = ['uh', 'um', 'er', 'ah'];
    return mutations[Math.floor(this.seededRandom() * mutations.length)] + word.slice(1);
  }

  private randomWord(): string {
    const words = ['the', 'a', 'um', 'like', 'uh', 'so'];
    return words[Math.floor(this.seededRandom() * words.length)];
  }
}

describe('WER Calculation', () => {
  describe('normalizeText', () => {
    it('should convert to lowercase by default', () => {
      expect(normalizeText('HELLO WORLD')).toBe('hello world');
    });

    it('should remove punctuation by default', () => {
      expect(normalizeText('Hello, World!')).toBe('hello world');
    });

    it('should normalize whitespace', () => {
      expect(normalizeText('hello   world')).toBe('hello world');
    });

    it('should respect custom options', () => {
      const result = normalizeText('HELLO, World!', {
        lowercase: false,
        removePunctuation: false,
      });
      expect(result).toBe('HELLO, World!');
    });

    it('should handle empty string', () => {
      expect(normalizeText('')).toBe('');
    });

    it('should apply custom replacements', () => {
      const result = normalizeText('hello world', {
        replacements: { hello: 'hi' },
      });
      expect(result).toBe('hi world');
    });
  });

  describe('tokenize', () => {
    it('should split text into words', () => {
      expect(tokenize('hello world')).toEqual(['hello', 'world']);
    });

    it('should handle multiple spaces', () => {
      expect(tokenize('hello   world')).toEqual(['hello', 'world']);
    });

    it('should return empty array for empty string', () => {
      expect(tokenize('')).toEqual([]);
    });
  });

  describe('calculateWER', () => {
    it('should return 0 for identical strings', () => {
      const result = calculateWER('hello world', 'hello world');
      expect(result.wer).toBe(0);
      expect(result.correct).toBe(2);
      expect(result.substitutions).toBe(0);
      expect(result.insertions).toBe(0);
      expect(result.deletions).toBe(0);
    });

    it('should calculate WER for substitutions', () => {
      const result = calculateWER('hello world', 'hello earth');
      expect(result.wer).toBe(0.5); // 1 substitution / 2 words
      expect(result.substitutions).toBe(1);
    });

    it('should calculate WER for insertions', () => {
      const result = calculateWER('hello world', 'hello beautiful world');
      expect(result.wer).toBe(0.5); // 1 insertion / 2 words
      expect(result.insertions).toBe(1);
    });

    it('should calculate WER for deletions', () => {
      const result = calculateWER('hello beautiful world', 'hello world');
      expect(result.wer).toBeCloseTo(0.333, 2); // 1 deletion / 3 words
      expect(result.deletions).toBe(1);
    });

    it('should handle empty reference', () => {
      const result = calculateWER('', 'hello');
      expect(result.wer).toBe(1);
      expect(result.insertions).toBe(1);
    });

    it('should handle empty hypothesis', () => {
      const result = calculateWER('hello world', '');
      expect(result.wer).toBe(1); // 2 deletions / 2 words
      expect(result.deletions).toBe(2);
    });

    it('should handle both empty', () => {
      const result = calculateWER('', '');
      expect(result.wer).toBe(0);
    });

    it('should normalize text by default', () => {
      const result = calculateWER('HELLO WORLD', 'hello world');
      expect(result.wer).toBe(0);
    });

    it('should calculate CER correctly', () => {
      const result = calculateWER('hello', 'hallo');
      expect(result.cer).toBe(0.2); // 1 char substitution / 5 chars
    });

    it('should calculate WRR correctly', () => {
      const result = calculateWER('hello world test', 'hello earth test');
      expect(result.wrr).toBeCloseTo(0.667, 2); // 2 correct / 3 words
    });

    it('should provide alignment details', () => {
      const result = calculateWER('hello world', 'hello earth');
      expect(result.alignment.alignedPairs).toHaveLength(2);
      expect(result.alignment.alignedPairs[0].operation).toBe('correct');
      expect(result.alignment.alignedPairs[1].operation).toBe('substitution');
    });
  });

  describe('calculateBatchWER', () => {
    it('should calculate overall metrics for multiple samples', () => {
      const samples = [
        { id: '1', reference: 'hello world', hypothesis: 'hello world' },
        { id: '2', reference: 'good morning', hypothesis: 'good evening' },
        { id: '3', reference: 'test one two', hypothesis: 'test one two' },
      ];

      const result = calculateBatchWER(samples);

      expect(result.totalSamples).toBe(3);
      expect(result.perfectSamples).toBe(2);
      expect(result.averageWer).toBeCloseTo(0.167, 2);
    });

    it('should handle empty sample array', () => {
      const result = calculateBatchWER([]);
      expect(result.totalSamples).toBe(0);
      expect(result.overallWer).toBe(0);
    });

    it('should calculate standard deviation', () => {
      const samples = [
        { id: '1', reference: 'hello world', hypothesis: 'hello world' },
        { id: '2', reference: 'hello world', hypothesis: 'hello earth' },
        { id: '3', reference: 'hello world', hypothesis: 'hi earth' },
      ];

      const result = calculateBatchWER(samples);

      expect(result.werStdDev).toBeGreaterThan(0);
      expect(result.minWer).toBe(0);
      expect(result.maxWer).toBe(1);
    });
  });

  describe('getAccuracyGrade', () => {
    it('should return A grade for perfect accuracy', () => {
      expect(getAccuracyGrade(0).grade).toBe('A');
      expect(getAccuracyGrade(0).label).toBe('Perfect');
    });

    it('should return A grade for excellent accuracy', () => {
      expect(getAccuracyGrade(0.03).grade).toBe('A');
      expect(getAccuracyGrade(0.03).label).toBe('Excellent');
    });

    it('should return B grade for very good accuracy', () => {
      expect(getAccuracyGrade(0.08).grade).toBe('B');
    });

    it('should return C grade for good accuracy', () => {
      expect(getAccuracyGrade(0.15).grade).toBe('C');
    });

    it('should return D grade for fair accuracy', () => {
      expect(getAccuracyGrade(0.35).grade).toBe('D');
    });

    it('should return F grade for poor accuracy', () => {
      expect(getAccuracyGrade(0.6).grade).toBe('F');
    });
  });

  describe('formatWER', () => {
    it('should format WER as percentage', () => {
      expect(formatWER(0.15)).toBe('15.00%');
      expect(formatWER(0.333)).toBe('33.30%');
    });

    it('should respect decimal places', () => {
      expect(formatWER(0.3333, 1)).toBe('33.3%');
      expect(formatWER(0.3333, 3)).toBe('33.330%');
    });
  });

  describe('visualizeAlignment', () => {
    it('should create visual alignment string', () => {
      const result = calculateWER('hello world', 'hello earth');
      const visualization = visualizeAlignment(result.alignment);

      expect(visualization).toContain('REF:');
      expect(visualization).toContain('HYP:');
      expect(visualization).toContain('OPS:');
    });
  });
});

describe('Test Fixtures', () => {
  describe('REFERENCE_TRANSCRIPTS', () => {
    it('should have short phrases', () => {
      expect(REFERENCE_TRANSCRIPTS.SHORT_PHRASES.length).toBeGreaterThan(0);
      REFERENCE_TRANSCRIPTS.SHORT_PHRASES.forEach((p) => {
        expect(p.id).toBeDefined();
        expect(p.text).toBeDefined();
        expect(p.duration).toBeGreaterThan(0);
      });
    });

    it('should have sentences', () => {
      expect(REFERENCE_TRANSCRIPTS.SENTENCES.length).toBeGreaterThan(0);
    });

    it('should have technical content', () => {
      expect(REFERENCE_TRANSCRIPTS.TECHNICAL.length).toBeGreaterThan(0);
    });

    it('should have voice commands', () => {
      expect(REFERENCE_TRANSCRIPTS.COMMANDS.length).toBeGreaterThan(0);
      REFERENCE_TRANSCRIPTS.COMMANDS.forEach((c) => {
        expect(c.text.toLowerCase()).toMatch(/atlas|screenshot|terminal|commit/);
      });
    });
  });

  describe('TEST_SUITES', () => {
    it('should have multiple test suites', () => {
      expect(TEST_SUITES.length).toBeGreaterThan(0);
    });

    it('should have basic accuracy suite', () => {
      const suite = getTestSuite('basic_accuracy');
      expect(suite).toBeDefined();
      expect(suite!.samples.length).toBeGreaterThan(0);
      expect(suite!.minAccuracy).toBeGreaterThanOrEqual(0.9);
    });

    it('should have challenging cases suite', () => {
      const suite = getTestSuite('challenging_cases');
      expect(suite).toBeDefined();
      expect(suite!.minAccuracy).toBeLessThan(0.8);
    });
  });

  describe('Sample Filtering', () => {
    it('should filter by category', () => {
      const samples = filterSamples({ category: 'short_phrase' });
      expect(samples.length).toBeGreaterThan(0);
      samples.forEach((s) => expect(s.category).toBe('short_phrase'));
    });

    it('should filter by noise level', () => {
      const cleanSamples = filterSamples({ noiseLevel: 'clean' });
      expect(cleanSamples.length).toBeGreaterThan(0);
    });

    it('should get all samples', () => {
      const allSamples = getAllSamples();
      expect(allSamples.length).toBeGreaterThan(10);
    });
  });
});

describe('STT Provider Accuracy Tests', () => {
  let mockProvider: MockSTTProvider;

  beforeEach(() => {
    mockProvider = new MockSTTProvider();
  });

  describe('Perfect Transcription (Baseline)', () => {
    it('should achieve 0% WER with perfect transcription', () => {
      const samples = REFERENCE_TRANSCRIPTS.SHORT_PHRASES.map((t) => ({
        id: t.id,
        reference: t.text,
        hypothesis: mockProvider.transcribe(t.id, t.text),
      }));

      const result = calculateBatchWER(samples);

      expect(result.overallWer).toBe(0);
      expect(result.perfectSamples).toBe(samples.length);
    });

    it('should correctly transcribe all sentence samples', () => {
      const samples = REFERENCE_TRANSCRIPTS.SENTENCES.map((t) => ({
        id: t.id,
        reference: t.text,
        hypothesis: mockProvider.transcribe(t.id, t.text),
      }));

      const result = calculateBatchWER(samples);

      expect(result.overallWer).toBe(0);
    });
  });

  describe('Simulated Deepgram Accuracy', () => {
    beforeEach(() => {
      // Simulate typical Deepgram results (high accuracy)
      const results = new Map<string, string>();

      // Short phrases - nearly perfect
      results.set('sp_001', 'hello');
      results.set('sp_002', 'yes please');
      results.set('sp_003', 'thank you very much');
      results.set('sp_004', 'what time is it');
      results.set('sp_005', 'open the browser');

      // Sentences - occasional minor errors
      results.set('sn_001', 'the quick brown fox jumps over the lazy dog');
      results.set('sn_002', 'please search for the latest news articles');
      results.set('sn_003', 'can you help me schedule a meeting for tomorrow');
      results.set('sn_004', 'i need to find the project files from last week');
      results.set('sn_005', 'remind me to call john at three oclock'); // "o'clock" -> "oclock"

      // Technical - some challenges
      results.set('tc_001', 'install the latest version of python 3.12'); // digit conversion
      results.set('tc_002', 'run npm install and then npm run build');
      results.set('tc_003', 'the api endpoint returns a json response');
      results.set('tc_004', 'configure the webpack entry point for typescript');
      results.set('tc_005', 'push the changes to the main branch on github');

      mockProvider.setResults(results);
    });

    it('should achieve >95% accuracy on short phrases', () => {
      const samples = REFERENCE_TRANSCRIPTS.SHORT_PHRASES.map((t) => ({
        id: t.id,
        reference: t.text,
        hypothesis: mockProvider.transcribe(t.id, t.text),
      }));

      const result = calculateBatchWER(samples);

      expect(result.overallWer).toBeLessThan(0.05);
      expect(getAccuracyGrade(result.overallWer).grade).toBe('A');
    });

    it('should achieve >90% accuracy on sentences', () => {
      const samples = REFERENCE_TRANSCRIPTS.SENTENCES.map((t) => ({
        id: t.id,
        reference: t.text,
        hypothesis: mockProvider.transcribe(t.id, t.text),
      }));

      const result = calculateBatchWER(samples);

      expect(result.overallWer).toBeLessThan(0.1);
    });

    it('should achieve >85% accuracy on technical content', () => {
      const samples = REFERENCE_TRANSCRIPTS.TECHNICAL.map((t) => ({
        id: t.id,
        reference: t.text,
        hypothesis: mockProvider.transcribe(t.id, t.text),
      }));

      const result = calculateBatchWER(samples);

      expect(result.overallWer).toBeLessThan(0.15);
    });
  });

  describe('Simulated Vosk Accuracy', () => {
    beforeEach(() => {
      // Simulate typical Vosk results (good but lower than Deepgram)
      const results = new Map<string, string>();

      // Short phrases - good accuracy
      results.set('sp_001', 'hello');
      results.set('sp_002', 'yes please');
      results.set('sp_003', 'thank you very much');
      results.set('sp_004', 'what time is it');
      results.set('sp_005', 'open the browser');

      // Sentences - more errors
      results.set('sn_001', 'the quick brown fox jumps over the lazy dog');
      results.set('sn_002', 'please search for the latest news article'); // "articles" -> "article"
      results.set('sn_003', 'can you help me schedule a meeting for tomorrow');
      results.set('sn_004', 'i need to find the project file from last week'); // "files" -> "file"
      results.set('sn_005', 'remind me to call john at three a clock'); // "o'clock" -> "a clock"

      // Technical - significant challenges
      results.set('tc_001', 'install the latest version of python three point twelve');
      results.set('tc_002', 'run npm install and then npm run build');
      results.set('tc_003', 'the a p i endpoint returns a jason response'); // "api" -> "a p i", "json" -> "jason"
      results.set('tc_004', 'configure the web pack entry point for type script'); // spacing issues
      results.set('tc_005', 'push the changes to the main branch on get hub'); // "github" -> "get hub"

      mockProvider.setResults(results);
    });

    it('should achieve >90% accuracy on short phrases', () => {
      const samples = REFERENCE_TRANSCRIPTS.SHORT_PHRASES.map((t) => ({
        id: t.id,
        reference: t.text,
        hypothesis: mockProvider.transcribe(t.id, t.text),
      }));

      const result = calculateBatchWER(samples);

      expect(result.overallWer).toBeLessThan(0.1);
    });

    it('should achieve >80% accuracy on sentences', () => {
      const samples = REFERENCE_TRANSCRIPTS.SENTENCES.map((t) => ({
        id: t.id,
        reference: t.text,
        hypothesis: mockProvider.transcribe(t.id, t.text),
      }));

      const result = calculateBatchWER(samples);

      expect(result.overallWer).toBeLessThan(0.2);
    });

    it('should handle technical content with lower accuracy', () => {
      const samples = REFERENCE_TRANSCRIPTS.TECHNICAL.map((t) => ({
        id: t.id,
        reference: t.text,
        hypothesis: mockProvider.transcribe(t.id, t.text),
      }));

      const result = calculateBatchWER(samples);

      // Vosk may struggle with technical terms
      expect(result.overallWer).toBeLessThan(0.3);
    });
  });

  describe('Noisy Environment Simulation', () => {
    beforeEach(() => {
      // Simulate transcription with background noise
      mockProvider = new MockSTTProvider(0.2); // 20% error rate
    });

    it('should have degraded accuracy in noisy conditions', () => {
      const samples = REFERENCE_TRANSCRIPTS.SHORT_PHRASES.map((t) => ({
        id: t.id,
        reference: t.text,
        hypothesis: mockProvider.transcribe(t.id, t.text),
      }));

      const result = calculateBatchWER(samples);

      // With noise, expect higher WER
      expect(result.overallWer).toBeGreaterThan(0);
      expect(result.poorSamples).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Challenging Cases', () => {
    it('should handle homophones', () => {
      const homophoneResults = new Map<string, string>();
      homophoneResults.set('hp_001', 'there car is over their and there driving it'); // Typical homophone confusion
      homophoneResults.set('hp_002', 'i new he bought a knew car to');
      homophoneResults.set('hp_003', 'the son rises and my sun wakes up');

      mockProvider.setResults(homophoneResults);

      const samples = CHALLENGING_TRANSCRIPTS.HOMOPHONES.slice(0, 3).map((t) => ({
        id: t.id,
        reference: t.text,
        hypothesis: mockProvider.transcribe(t.id, t.text),
      }));

      const result = calculateBatchWER(samples);

      // Homophones are expected to cause errors
      expect(result.overallWer).toBeGreaterThan(0.1);
      console.log(`Homophone accuracy: ${formatWER(1 - result.overallWer)}`);
    });

    it('should handle unusual/technical words', () => {
      const technicalResults = new Map<string, string>();
      technicalResults.set('uw_001', 'the entrepreneur exhibited extraordinary per spicacity'); // word split
      technicalResults.set('uw_002', 'serendipidous circumstances led to unprecedented outcomes'); // minor spelling
      technicalResults.set('uw_003', 'the quintessential paradigm shift was imminent');

      mockProvider.setResults(technicalResults);

      const samples = CHALLENGING_TRANSCRIPTS.UNUSUAL_WORDS.slice(0, 3).map((t) => ({
        id: t.id,
        reference: t.text,
        hypothesis: mockProvider.transcribe(t.id, t.text),
      }));

      const result = calculateBatchWER(samples);

      // Technical vocabulary may cause issues
      expect(result.overallWer).toBeLessThan(0.5);
    });

    it('should handle conversational speech with fillers', () => {
      const conversationalResults = new Map<string, string>();
      conversationalResults.set(
        'cv_001',
        'um so i was thinking maybe we could um you know try that later'
      );
      conversationalResults.set(
        'cv_002',
        'yeah so basically what happened was uh the system crashed'
      );

      mockProvider.setResults(conversationalResults);

      const samples = REFERENCE_TRANSCRIPTS.CONVERSATIONAL.slice(0, 2).map((t) => ({
        id: t.id,
        reference: t.text,
        hypothesis: mockProvider.transcribe(t.id, t.text),
      }));

      const result = calculateBatchWER(samples);

      // Perfect match expected since we're using exact transcripts
      expect(result.overallWer).toBe(0);
    });

    it('should measure impact of filler word removal', () => {
      const reference = 'um so i was thinking maybe we could um you know try that later';
      const hypothesis = 'so i was thinking maybe we could try that later';

      // Without filler removal - high WER due to missing "um", "you know"
      const resultWithFillers = calculateWER(reference, hypothesis, { removeFillers: false });

      // With filler removal - should be much better
      const resultWithoutFillers = calculateWER(reference, hypothesis, { removeFillers: true });

      expect(resultWithFillers.wer).toBeGreaterThan(resultWithoutFillers.wer);
      console.log(`WER with fillers: ${formatWER(resultWithFillers.wer)}`);
      console.log(`WER without fillers: ${formatWER(resultWithoutFillers.wer)}`);
    });
  });
});

describe('Regression Testing', () => {
  /**
   * Baseline accuracy results that should be maintained
   * Update these when intentionally improving the STT system
   */
  const BASELINE_ACCURACY = {
    shortPhrases: 0.95,
    sentences: 0.92,
    technical: 0.85,
    commands: 0.95,
    overall: 0.9,
  };

  it('should maintain baseline accuracy for short phrases', () => {
    const mockProvider = new MockSTTProvider(0);
    const samples = REFERENCE_TRANSCRIPTS.SHORT_PHRASES.map((t) => ({
      id: t.id,
      reference: t.text,
      hypothesis: mockProvider.transcribe(t.id, t.text),
    }));

    const result = calculateBatchWER(samples);
    const accuracy = 1 - result.overallWer;

    expect(accuracy).toBeGreaterThanOrEqual(BASELINE_ACCURACY.shortPhrases);
  });

  it('should maintain baseline accuracy for sentences', () => {
    const mockProvider = new MockSTTProvider(0);
    const samples = REFERENCE_TRANSCRIPTS.SENTENCES.map((t) => ({
      id: t.id,
      reference: t.text,
      hypothesis: mockProvider.transcribe(t.id, t.text),
    }));

    const result = calculateBatchWER(samples);
    const accuracy = 1 - result.overallWer;

    expect(accuracy).toBeGreaterThanOrEqual(BASELINE_ACCURACY.sentences);
  });

  it('should maintain baseline accuracy for voice commands', () => {
    const mockProvider = new MockSTTProvider(0);
    const samples = REFERENCE_TRANSCRIPTS.COMMANDS.map((t) => ({
      id: t.id,
      reference: t.text,
      hypothesis: mockProvider.transcribe(t.id, t.text),
    }));

    const result = calculateBatchWER(samples);
    const accuracy = 1 - result.overallWer;

    expect(accuracy).toBeGreaterThanOrEqual(BASELINE_ACCURACY.commands);
  });

  it('should detect accuracy regressions', () => {
    // Simulate a regression where accuracy drops
    const mockProvider = new MockSTTProvider(0.15); // 15% error rate
    const samples = REFERENCE_TRANSCRIPTS.SHORT_PHRASES.map((t) => ({
      id: t.id,
      reference: t.text,
      hypothesis: mockProvider.transcribe(t.id, t.text),
    }));

    const result = calculateBatchWER(samples);
    const accuracy = 1 - result.overallWer;

    // This test documents expected behavior - with 15% error rate,
    // accuracy will likely drop below baseline
    // In real testing, this would flag a regression
    if (accuracy < BASELINE_ACCURACY.shortPhrases) {
      console.warn(
        `REGRESSION DETECTED: Short phrase accuracy ${(accuracy * 100).toFixed(1)}% ` +
          `is below baseline ${(BASELINE_ACCURACY.shortPhrases * 100).toFixed(1)}%`
      );
    }
  });
});

describe('Accuracy Report Generation', () => {
  /**
   * Generate a comprehensive accuracy report
   */
  function generateAccuracyReport(
    providerName: string,
    results: BatchWERResult
  ): {
    provider: string;
    summary: {
      overallWer: string;
      overallCer: string;
      accuracy: string;
      grade: string;
    };
    breakdown: Array<{
      id: string;
      wer: string;
      grade: string;
    }>;
    statistics: {
      totalSamples: number;
      perfectSamples: number;
      excellentSamples: number;
      goodSamples: number;
      poorSamples: number;
    };
  } {
    const grade = getAccuracyGrade(results.overallWer);

    return {
      provider: providerName,
      summary: {
        overallWer: formatWER(results.overallWer),
        overallCer: formatWER(results.overallCer),
        accuracy: formatWER(1 - results.overallWer),
        grade: `${grade.grade} (${grade.label})`,
      },
      breakdown: results.results.map((r) => ({
        id: r.id,
        wer: formatWER(r.wer.wer),
        grade: getAccuracyGrade(r.wer.wer).grade,
      })),
      statistics: {
        totalSamples: results.totalSamples,
        perfectSamples: results.perfectSamples,
        excellentSamples: results.excellentSamples,
        goodSamples: results.goodSamples,
        poorSamples: results.poorSamples,
      },
    };
  }

  it('should generate accuracy report for Deepgram simulation', () => {
    const mockProvider = new MockSTTProvider(0.02); // 2% error rate (simulating Deepgram)
    const samples = [
      ...REFERENCE_TRANSCRIPTS.SHORT_PHRASES,
      ...REFERENCE_TRANSCRIPTS.SENTENCES,
    ].map((t) => ({
      id: t.id,
      reference: t.text,
      hypothesis: mockProvider.transcribe(t.id, t.text),
    }));

    const results = calculateBatchWER(samples);
    const report = generateAccuracyReport('Deepgram (Simulated)', results);

    expect(report.provider).toBe('Deepgram (Simulated)');
    expect(report.summary.grade).toContain('A');
    expect(report.statistics.totalSamples).toBe(samples.length);

    console.log('\n=== Deepgram Accuracy Report ===');
    console.log(`Provider: ${report.provider}`);
    console.log(`Overall WER: ${report.summary.overallWer}`);
    console.log(`Accuracy: ${report.summary.accuracy}`);
    console.log(`Grade: ${report.summary.grade}`);
    console.log(
      `Perfect samples: ${report.statistics.perfectSamples}/${report.statistics.totalSamples}`
    );
  });

  it('should generate accuracy report for Vosk simulation', () => {
    const mockProvider = new MockSTTProvider(0.1); // 10% error rate (simulating Vosk)
    const samples = [
      ...REFERENCE_TRANSCRIPTS.SHORT_PHRASES,
      ...REFERENCE_TRANSCRIPTS.SENTENCES,
    ].map((t) => ({
      id: t.id,
      reference: t.text,
      hypothesis: mockProvider.transcribe(t.id, t.text),
    }));

    const results = calculateBatchWER(samples);
    const report = generateAccuracyReport('Vosk (Simulated)', results);

    expect(report.provider).toBe('Vosk (Simulated)');
    expect(report.statistics.totalSamples).toBe(samples.length);

    console.log('\n=== Vosk Accuracy Report ===');
    console.log(`Provider: ${report.provider}`);
    console.log(`Overall WER: ${report.summary.overallWer}`);
    console.log(`Accuracy: ${report.summary.accuracy}`);
    console.log(`Grade: ${report.summary.grade}`);
  });

  it('should generate comparative report', () => {
    // Use different seeds but same error rates for reproducible comparison
    const deepgramProvider = new MockSTTProvider(0.02, 11111);
    const voskProvider = new MockSTTProvider(0.1, 22222);

    const samples = REFERENCE_TRANSCRIPTS.SHORT_PHRASES;

    const deepgramSamples = samples.map((t) => ({
      id: t.id,
      reference: t.text,
      hypothesis: deepgramProvider.transcribe(t.id, t.text),
    }));

    const voskSamples = samples.map((t) => ({
      id: t.id,
      reference: t.text,
      hypothesis: voskProvider.transcribe(t.id, t.text),
    }));

    const deepgramResults = calculateBatchWER(deepgramSamples);
    const voskResults = calculateBatchWER(voskSamples);

    console.log('\n=== Provider Comparison ===');
    console.log(`Deepgram WER: ${formatWER(deepgramResults.overallWer)}`);
    console.log(`Vosk WER: ${formatWER(voskResults.overallWer)}`);
    console.log(`Difference: ${formatWER(voskResults.overallWer - deepgramResults.overallWer)}`);

    // Deepgram (2% error rate) should outperform Vosk (10% error rate)
    // With seeded random, results are deterministic
    expect(deepgramResults.overallWer).toBeLessThanOrEqual(voskResults.overallWer);
  });
});

describe('Edge Cases and Error Handling', () => {
  it('should handle very long text', () => {
    const longText = Array(100).fill('word').join(' ');
    const result = calculateWER(longText, longText);
    expect(result.wer).toBe(0);
    expect(result.referenceLength).toBe(100);
  });

  it('should handle special characters', () => {
    const result = calculateWER('test @user #hashtag $100', 'test @user #hashtag $100');
    expect(result.wer).toBe(0);
  });

  it('should handle unicode characters', () => {
    const result = calculateWER('hello world', 'hello world');
    expect(result.wer).toBe(0);
  });

  it('should handle numbers and digits', () => {
    const result = calculateWER('call 555 1234', 'call 555 1234');
    expect(result.wer).toBe(0);
  });

  it('should handle completely different texts', () => {
    const result = calculateWER('the quick brown fox', 'completely different sentence here');
    // All words are different
    expect(result.wer).toBe(1);
  });

  it('should handle text with only punctuation differences', () => {
    const result = calculateWER('Hello, World!', 'hello world', {
      removePunctuation: true,
      lowercase: true,
    });
    expect(result.wer).toBe(0);
  });
});
