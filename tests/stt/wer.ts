/**
 * Atlas Desktop - Word Error Rate (WER) Calculation Utilities
 *
 * Provides comprehensive metrics for evaluating STT accuracy including:
 * - Word Error Rate (WER)
 * - Character Error Rate (CER)
 * - Word Information Lost (WIL)
 * - Match Error Rate (MER)
 * - Word Recognition Rate (WRR)
 */

/**
 * Edit operation types for alignment
 */
export type EditOperation = 'correct' | 'substitution' | 'insertion' | 'deletion';

/**
 * Alignment result between reference and hypothesis
 */
export interface AlignmentResult {
  /** Reference tokens */
  reference: string[];
  /** Hypothesis tokens */
  hypothesis: string[];
  /** Alignment operations */
  operations: EditOperation[];
  /** Aligned pairs */
  alignedPairs: Array<{
    ref: string | null;
    hyp: string | null;
    operation: EditOperation;
  }>;
}

/**
 * Detailed WER calculation result
 */
export interface WERResult {
  /** Word Error Rate (0-1, can exceed 1 for very poor transcriptions) */
  wer: number;
  /** Character Error Rate */
  cer: number;
  /** Word Information Lost */
  wil: number;
  /** Match Error Rate */
  mer: number;
  /** Word Recognition Rate */
  wrr: number;
  /** Number of correct words */
  correct: number;
  /** Number of substitutions */
  substitutions: number;
  /** Number of insertions */
  insertions: number;
  /** Number of deletions */
  deletions: number;
  /** Total words in reference */
  referenceLength: number;
  /** Total words in hypothesis */
  hypothesisLength: number;
  /** Alignment details */
  alignment: AlignmentResult;
}

/**
 * Batch evaluation result
 */
export interface BatchWERResult {
  /** Overall WER across all samples */
  overallWer: number;
  /** Overall CER */
  overallCer: number;
  /** Average WER per sample */
  averageWer: number;
  /** Standard deviation of WER */
  werStdDev: number;
  /** Minimum WER */
  minWer: number;
  /** Maximum WER */
  maxWer: number;
  /** Individual results */
  results: Array<{
    id: string;
    reference: string;
    hypothesis: string;
    wer: WERResult;
  }>;
  /** Total samples */
  totalSamples: number;
  /** Samples with WER = 0 (perfect) */
  perfectSamples: number;
  /** Samples with WER <= 0.1 (excellent) */
  excellentSamples: number;
  /** Samples with WER <= 0.2 (good) */
  goodSamples: number;
  /** Samples with WER > 0.5 (poor) */
  poorSamples: number;
}

/**
 * Text normalization options
 */
export interface NormalizationOptions {
  /** Convert to lowercase */
  lowercase?: boolean;
  /** Remove punctuation */
  removePunctuation?: boolean;
  /** Remove filler words (um, uh, etc.) */
  removeFillers?: boolean;
  /** Normalize numbers (three -> 3) */
  normalizeNumbers?: boolean;
  /** Remove extra whitespace */
  normalizeWhitespace?: boolean;
  /** Custom word replacements */
  replacements?: Record<string, string>;
}

const DEFAULT_NORMALIZATION: NormalizationOptions = {
  lowercase: true,
  removePunctuation: true,
  removeFillers: false,
  normalizeNumbers: false,
  normalizeWhitespace: true,
};

/**
 * Common filler words to remove
 */
const FILLER_WORDS = new Set([
  'um', 'uh', 'er', 'ah', 'like', 'you know', 'i mean',
  'basically', 'actually', 'literally', 'so', 'well',
]);

/**
 * Normalize text for comparison
 */
export function normalizeText(text: string, options: NormalizationOptions = {}): string {
  const opts = { ...DEFAULT_NORMALIZATION, ...options };
  let normalized = text;

  // Lowercase
  if (opts.lowercase) {
    normalized = normalized.toLowerCase();
  }

  // Remove punctuation
  if (opts.removePunctuation) {
    normalized = normalized.replace(/[.,!?;:'"()[\]{}]/g, '');
  }

  // Normalize whitespace
  if (opts.normalizeWhitespace) {
    normalized = normalized.replace(/\s+/g, ' ').trim();
  }

  // Remove filler words
  if (opts.removeFillers) {
    const words = normalized.split(' ');
    normalized = words.filter((w) => !FILLER_WORDS.has(w)).join(' ');
  }

  // Apply custom replacements
  if (opts.replacements) {
    for (const [from, to] of Object.entries(opts.replacements)) {
      normalized = normalized.replace(new RegExp(from, 'gi'), to);
    }
  }

  return normalized;
}

/**
 * Tokenize text into words
 */
export function tokenize(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

/**
 * Calculate Levenshtein distance between two arrays
 * Returns the edit distance matrix and operations
 */
function levenshteinWithOps(
  ref: string[],
  hyp: string[]
): { distance: number; matrix: number[][]; ops: EditOperation[] } {
  const n = ref.length;
  const m = hyp.length;

  // Create distance matrix
  const matrix: number[][] = Array(n + 1)
    .fill(null)
    .map(() => Array(m + 1).fill(0));

  // Initialize first column (deletions)
  for (let i = 0; i <= n; i++) {
    matrix[i][0] = i;
  }

  // Initialize first row (insertions)
  for (let j = 0; j <= m; j++) {
    matrix[0][j] = j;
  }

  // Fill the matrix
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // Deletion
        matrix[i][j - 1] + 1, // Insertion
        matrix[i - 1][j - 1] + cost // Substitution or match
      );
    }
  }

  // Backtrack to find operations
  const ops: EditOperation[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1]) {
      ops.unshift('correct');
      i--;
      j--;
    } else if (i > 0 && j > 0 && matrix[i][j] === matrix[i - 1][j - 1] + 1) {
      ops.unshift('substitution');
      i--;
      j--;
    } else if (j > 0 && matrix[i][j] === matrix[i][j - 1] + 1) {
      ops.unshift('insertion');
      j--;
    } else if (i > 0 && matrix[i][j] === matrix[i - 1][j] + 1) {
      ops.unshift('deletion');
      i--;
    } else {
      break;
    }
  }

  return { distance: matrix[n][m], matrix, ops };
}

/**
 * Build alignment from operations
 */
function buildAlignment(ref: string[], hyp: string[], ops: EditOperation[]): AlignmentResult {
  const alignedPairs: AlignmentResult['alignedPairs'] = [];
  let refIdx = 0;
  let hypIdx = 0;

  for (const op of ops) {
    switch (op) {
      case 'correct':
      case 'substitution':
        alignedPairs.push({
          ref: ref[refIdx],
          hyp: hyp[hypIdx],
          operation: op,
        });
        refIdx++;
        hypIdx++;
        break;
      case 'insertion':
        alignedPairs.push({
          ref: null,
          hyp: hyp[hypIdx],
          operation: op,
        });
        hypIdx++;
        break;
      case 'deletion':
        alignedPairs.push({
          ref: ref[refIdx],
          hyp: null,
          operation: op,
        });
        refIdx++;
        break;
    }
  }

  return {
    reference: ref,
    hypothesis: hyp,
    operations: ops,
    alignedPairs,
  };
}

/**
 * Calculate Word Error Rate and related metrics
 *
 * @param reference - Reference transcript (ground truth)
 * @param hypothesis - Hypothesis transcript (STT output)
 * @param options - Normalization options
 * @returns Detailed WER result
 */
export function calculateWER(
  reference: string,
  hypothesis: string,
  options: NormalizationOptions = {}
): WERResult {
  // Normalize texts
  const normalizedRef = normalizeText(reference, options);
  const normalizedHyp = normalizeText(hypothesis, options);

  // Tokenize
  const refTokens = tokenize(normalizedRef);
  const hypTokens = tokenize(normalizedHyp);

  // Handle edge cases
  if (refTokens.length === 0) {
    return {
      wer: hypTokens.length > 0 ? 1 : 0,
      cer: hypothesis.length > 0 ? 1 : 0,
      wil: hypTokens.length > 0 ? 1 : 0,
      mer: hypTokens.length > 0 ? 1 : 0,
      wrr: hypTokens.length > 0 ? 0 : 1,
      correct: 0,
      substitutions: 0,
      insertions: hypTokens.length,
      deletions: 0,
      referenceLength: 0,
      hypothesisLength: hypTokens.length,
      alignment: {
        reference: [],
        hypothesis: hypTokens,
        operations: hypTokens.map(() => 'insertion' as const),
        alignedPairs: hypTokens.map((h) => ({ ref: null, hyp: h, operation: 'insertion' as const })),
      },
    };
  }

  // Calculate edit distance and operations
  const { ops } = levenshteinWithOps(refTokens, hypTokens);

  // Count operations
  const correct = ops.filter((op) => op === 'correct').length;
  const substitutions = ops.filter((op) => op === 'substitution').length;
  const insertions = ops.filter((op) => op === 'insertion').length;
  const deletions = ops.filter((op) => op === 'deletion').length;

  // Calculate WER: (S + D + I) / N
  const wer = (substitutions + deletions + insertions) / refTokens.length;

  // Calculate CER (character level)
  const refChars = normalizedRef.replace(/\s/g, '').split('');
  const hypChars = normalizedHyp.replace(/\s/g, '').split('');
  const { distance: charDistance } = levenshteinWithOps(refChars, hypChars);
  const cer = refChars.length > 0 ? charDistance / refChars.length : hypChars.length > 0 ? 1 : 0;

  // Calculate Word Information Lost (WIL)
  // WIL = 1 - (H^2 / (R * O)) where H = correct hits, R = reference length, O = hypothesis length
  const wil =
    hypTokens.length > 0 && refTokens.length > 0
      ? 1 - (correct * correct) / (refTokens.length * hypTokens.length)
      : 1;

  // Calculate Match Error Rate (MER)
  // MER = (S + D + I) / (H + S + D + I)
  const totalOps = correct + substitutions + deletions + insertions;
  const mer = totalOps > 0 ? (substitutions + deletions + insertions) / totalOps : 0;

  // Calculate Word Recognition Rate (WRR)
  // WRR = H / N
  const wrr = correct / refTokens.length;

  // Build alignment
  const alignment = buildAlignment(refTokens, hypTokens, ops);

  return {
    wer,
    cer,
    wil,
    mer,
    wrr,
    correct,
    substitutions,
    insertions,
    deletions,
    referenceLength: refTokens.length,
    hypothesisLength: hypTokens.length,
    alignment,
  };
}

/**
 * Calculate batch WER for multiple samples
 */
export function calculateBatchWER(
  samples: Array<{ id: string; reference: string; hypothesis: string }>,
  options: NormalizationOptions = {}
): BatchWERResult {
  if (samples.length === 0) {
    return {
      overallWer: 0,
      overallCer: 0,
      averageWer: 0,
      werStdDev: 0,
      minWer: 0,
      maxWer: 0,
      results: [],
      totalSamples: 0,
      perfectSamples: 0,
      excellentSamples: 0,
      goodSamples: 0,
      poorSamples: 0,
    };
  }

  // Calculate individual WERs
  const results = samples.map((sample) => ({
    id: sample.id,
    reference: sample.reference,
    hypothesis: sample.hypothesis,
    wer: calculateWER(sample.reference, sample.hypothesis, options),
  }));

  // Calculate overall metrics
  let totalRefWords = 0;
  let totalErrors = 0;
  let totalRefChars = 0;
  let totalCharErrors = 0;

  for (const result of results) {
    totalRefWords += result.wer.referenceLength;
    totalErrors += result.wer.substitutions + result.wer.deletions + result.wer.insertions;

    const normalizedRef = normalizeText(result.reference, options).replace(/\s/g, '');
    const normalizedHyp = normalizeText(result.hypothesis, options).replace(/\s/g, '');
    totalRefChars += normalizedRef.length;
    const { distance } = levenshteinWithOps(normalizedRef.split(''), normalizedHyp.split(''));
    totalCharErrors += distance;
  }

  const overallWer = totalRefWords > 0 ? totalErrors / totalRefWords : 0;
  const overallCer = totalRefChars > 0 ? totalCharErrors / totalRefChars : 0;

  // Calculate statistics
  const wers = results.map((r) => r.wer.wer);
  const averageWer = wers.reduce((a, b) => a + b, 0) / wers.length;
  const minWer = Math.min(...wers);
  const maxWer = Math.max(...wers);

  // Standard deviation
  const squaredDiffs = wers.map((w) => Math.pow(w - averageWer, 2));
  const werStdDev = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / wers.length);

  // Category counts
  const perfectSamples = wers.filter((w) => w === 0).length;
  const excellentSamples = wers.filter((w) => w > 0 && w <= 0.1).length;
  const goodSamples = wers.filter((w) => w > 0.1 && w <= 0.2).length;
  const poorSamples = wers.filter((w) => w > 0.5).length;

  return {
    overallWer,
    overallCer,
    averageWer,
    werStdDev,
    minWer,
    maxWer,
    results,
    totalSamples: samples.length,
    perfectSamples,
    excellentSamples,
    goodSamples,
    poorSamples,
  };
}

/**
 * Get accuracy grade based on WER
 */
export function getAccuracyGrade(wer: number): {
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  label: string;
  color: string;
} {
  if (wer === 0) {
    return { grade: 'A', label: 'Perfect', color: 'green' };
  } else if (wer <= 0.05) {
    return { grade: 'A', label: 'Excellent', color: 'green' };
  } else if (wer <= 0.1) {
    return { grade: 'B', label: 'Very Good', color: 'lightgreen' };
  } else if (wer <= 0.2) {
    return { grade: 'C', label: 'Good', color: 'yellow' };
  } else if (wer <= 0.5) {
    return { grade: 'D', label: 'Fair', color: 'orange' };
  } else {
    return { grade: 'F', label: 'Poor', color: 'red' };
  }
}

/**
 * Format WER as percentage string
 */
export function formatWER(wer: number, decimals = 2): string {
  return `${(wer * 100).toFixed(decimals)}%`;
}

/**
 * Generate a visual alignment string for debugging
 */
export function visualizeAlignment(alignment: AlignmentResult): string {
  const lines: string[] = [];
  const maxLen = Math.max(
    ...alignment.alignedPairs.map((p) => Math.max(p.ref?.length || 0, p.hyp?.length || 0, 3))
  );

  let refLine = 'REF: ';
  let hypLine = 'HYP: ';
  let opsLine = 'OPS: ';

  for (const pair of alignment.alignedPairs) {
    const ref = (pair.ref || '***').padEnd(maxLen);
    const hyp = (pair.hyp || '***').padEnd(maxLen);
    let op = '';

    switch (pair.operation) {
      case 'correct':
        op = '='.repeat(maxLen);
        break;
      case 'substitution':
        op = 'S'.repeat(maxLen);
        break;
      case 'insertion':
        op = 'I'.repeat(maxLen);
        break;
      case 'deletion':
        op = 'D'.repeat(maxLen);
        break;
    }

    refLine += ref + ' ';
    hypLine += hyp + ' ';
    opsLine += op + ' ';
  }

  lines.push(refLine);
  lines.push(hypLine);
  lines.push(opsLine);

  return lines.join('\n');
}

export default {
  calculateWER,
  calculateBatchWER,
  normalizeText,
  tokenize,
  getAccuracyGrade,
  formatWER,
  visualizeAlignment,
};
