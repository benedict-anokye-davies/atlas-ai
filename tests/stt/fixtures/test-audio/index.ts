/**
 * Atlas Desktop - STT Accuracy Test Audio Fixtures
 *
 * Provides test audio samples with reference transcripts for accuracy testing.
 * Includes various accent categories, speech speeds, and noise conditions.
 */

/**
 * Audio sample metadata
 */
export interface AudioSample {
  /** Unique identifier for the sample */
  id: string;
  /** Reference transcript (ground truth) */
  transcript: string;
  /** Category of the sample */
  category: SampleCategory;
  /** Accent or speaker variation */
  accent?: AccentType;
  /** Speech speed */
  speed?: SpeechSpeed;
  /** Noise level */
  noiseLevel?: NoiseLevel;
  /** Duration in seconds */
  duration: number;
  /** Sample rate in Hz */
  sampleRate: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Categories of test samples
 */
export type SampleCategory =
  | 'short_phrase' // 1-5 words
  | 'sentence' // 6-20 words
  | 'paragraph' // Multiple sentences
  | 'numbers' // Numerical content
  | 'technical' // Technical jargon
  | 'names' // Proper nouns
  | 'commands' // Voice commands
  | 'conversational'; // Natural speech patterns

/**
 * Accent variations for testing
 */
export type AccentType =
  | 'us_standard' // Standard American English
  | 'us_southern' // Southern US accent
  | 'us_midwest' // Midwest US accent
  | 'uk_received' // British RP
  | 'uk_scottish' // Scottish accent
  | 'australian' // Australian English
  | 'indian' // Indian English
  | 'non_native'; // Non-native English speaker

/**
 * Speech speed variations
 */
export type SpeechSpeed =
  | 'slow' // < 120 WPM
  | 'normal' // 120-150 WPM
  | 'fast'; // > 150 WPM

/**
 * Noise level categories
 */
export type NoiseLevel =
  | 'clean' // No background noise
  | 'low' // Light background noise (office, fan)
  | 'medium' // Moderate noise (coffee shop)
  | 'high'; // Significant noise (street, crowd)

/**
 * Test suite for STT accuracy
 */
export interface TestSuite {
  /** Suite name */
  name: string;
  /** Suite description */
  description: string;
  /** Audio samples in the suite */
  samples: AudioSample[];
  /** Expected minimum accuracy (0-1) */
  minAccuracy?: number;
}

/**
 * Reference transcripts for common test phrases
 * These are used with synthetically generated audio
 */
export const REFERENCE_TRANSCRIPTS = {
  // Short phrases (1-5 words)
  SHORT_PHRASES: [
    { id: 'sp_001', text: 'hello', duration: 0.5 },
    { id: 'sp_002', text: 'yes please', duration: 0.7 },
    { id: 'sp_003', text: 'thank you very much', duration: 1.0 },
    { id: 'sp_004', text: 'what time is it', duration: 1.0 },
    { id: 'sp_005', text: 'open the browser', duration: 1.0 },
  ],

  // Full sentences
  SENTENCES: [
    { id: 'sn_001', text: 'the quick brown fox jumps over the lazy dog', duration: 2.5 },
    { id: 'sn_002', text: 'please search for the latest news articles', duration: 2.0 },
    { id: 'sn_003', text: 'can you help me schedule a meeting for tomorrow', duration: 2.5 },
    { id: 'sn_004', text: 'i need to find the project files from last week', duration: 2.5 },
    { id: 'sn_005', text: 'remind me to call john at three oclock', duration: 2.0 },
  ],

  // Technical content
  TECHNICAL: [
    { id: 'tc_001', text: 'install the latest version of python three point twelve', duration: 3.0 },
    { id: 'tc_002', text: 'run npm install and then npm run build', duration: 2.5 },
    { id: 'tc_003', text: 'the api endpoint returns a json response', duration: 2.5 },
    { id: 'tc_004', text: 'configure the webpack entry point for typescript', duration: 3.0 },
    { id: 'tc_005', text: 'push the changes to the main branch on github', duration: 2.5 },
  ],

  // Numbers and alphanumerics
  NUMBERS: [
    { id: 'nm_001', text: 'one two three four five', duration: 2.0 },
    { id: 'nm_002', text: 'call nine one one immediately', duration: 2.0 },
    { id: 'nm_003', text: 'the total is forty two dollars and fifty cents', duration: 2.5 },
    { id: 'nm_004', text: 'my phone number is five five five one two three four', duration: 3.0 },
    { id: 'nm_005', text: 'version two point zero point one released in twenty twenty four', duration: 3.5 },
  ],

  // Names and proper nouns
  NAMES: [
    { id: 'nm_001', text: 'send an email to john smith', duration: 1.5 },
    { id: 'nm_002', text: 'schedule a meeting with sarah johnson', duration: 2.0 },
    { id: 'nm_003', text: 'open microsoft word document', duration: 1.5 },
    { id: 'nm_004', text: 'search for elon musk on twitter', duration: 2.0 },
    { id: 'nm_005', text: 'book a flight to san francisco california', duration: 2.5 },
  ],

  // Voice commands (Atlas-specific)
  COMMANDS: [
    { id: 'cm_001', text: 'hey atlas open my documents', duration: 1.5 },
    { id: 'cm_002', text: 'atlas search the web for weather forecast', duration: 2.0 },
    { id: 'cm_003', text: 'take a screenshot of this window', duration: 1.5 },
    { id: 'cm_004', text: 'run the build command in terminal', duration: 1.5 },
    { id: 'cm_005', text: 'commit changes with message fix typo', duration: 2.0 },
  ],

  // Conversational patterns
  CONVERSATIONAL: [
    { id: 'cv_001', text: 'um so i was thinking maybe we could um you know try that later', duration: 4.0 },
    { id: 'cv_002', text: 'yeah so basically what happened was uh the system crashed', duration: 3.0 },
    { id: 'cv_003', text: 'okay so lets see here i think we need to uh check the logs', duration: 3.5 },
    { id: 'cv_004', text: 'well actually no wait i meant the other file not that one', duration: 3.0 },
    { id: 'cv_005', text: 'hmm interesting so what you are saying is we should refactor', duration: 3.0 },
  ],
} as const;

/**
 * Challenging transcripts for edge case testing
 */
export const CHALLENGING_TRANSCRIPTS = {
  // Homophones
  HOMOPHONES: [
    { id: 'hp_001', text: 'their car is over there and they are driving it', duration: 3.0 },
    { id: 'hp_002', text: 'i knew he bought a new car too', duration: 2.0 },
    { id: 'hp_003', text: 'the sun rises and my son wakes up', duration: 2.0 },
    { id: 'hp_004', text: 'write the right answer on the paper', duration: 2.0 },
    { id: 'hp_005', text: 'accept this gift except the flowers', duration: 2.0 },
  ],

  // Rare/unusual words
  UNUSUAL_WORDS: [
    { id: 'uw_001', text: 'the entrepreneur exhibited extraordinary perspicacity', duration: 3.0 },
    { id: 'uw_002', text: 'serendipitous circumstances led to unprecedented outcomes', duration: 3.0 },
    { id: 'uw_003', text: 'the quintessential paradigm shift was imminent', duration: 2.5 },
    { id: 'uw_004', text: 'cryptocurrency blockchain decentralization tokenomics', duration: 3.0 },
    { id: 'uw_005', text: 'kubernetes orchestration microservices containerization', duration: 3.0 },
  ],

  // Punctuation-dependent meaning
  PUNCTUATION_SENSITIVE: [
    { id: 'ps_001', text: 'lets eat grandma', duration: 1.0 }, // vs "let's eat, grandma"
    { id: 'ps_002', text: 'a woman without her man is nothing', duration: 2.0 },
    { id: 'ps_003', text: 'time flies like an arrow fruit flies like a banana', duration: 3.0 },
    { id: 'ps_004', text: 'i like cooking my family and my pets', duration: 2.0 },
    { id: 'ps_005', text: 'she said he was wrong', duration: 1.5 },
  ],
};

/**
 * Pre-defined test suites for different testing scenarios
 */
export const TEST_SUITES: TestSuite[] = [
  {
    name: 'basic_accuracy',
    description: 'Basic accuracy test with clean audio and standard speech',
    samples: createSamplesFromTranscripts(REFERENCE_TRANSCRIPTS.SHORT_PHRASES, {
      category: 'short_phrase',
      accent: 'us_standard',
      speed: 'normal',
      noiseLevel: 'clean',
    }),
    minAccuracy: 0.95,
  },
  {
    name: 'sentence_accuracy',
    description: 'Full sentence accuracy test',
    samples: createSamplesFromTranscripts(REFERENCE_TRANSCRIPTS.SENTENCES, {
      category: 'sentence',
      accent: 'us_standard',
      speed: 'normal',
      noiseLevel: 'clean',
    }),
    minAccuracy: 0.92,
  },
  {
    name: 'technical_vocabulary',
    description: 'Technical jargon and programming terminology',
    samples: createSamplesFromTranscripts(REFERENCE_TRANSCRIPTS.TECHNICAL, {
      category: 'technical',
      accent: 'us_standard',
      speed: 'normal',
      noiseLevel: 'clean',
    }),
    minAccuracy: 0.85,
  },
  {
    name: 'numbers_and_digits',
    description: 'Numbers, phone numbers, and numerical content',
    samples: createSamplesFromTranscripts(REFERENCE_TRANSCRIPTS.NUMBERS, {
      category: 'numbers',
      accent: 'us_standard',
      speed: 'normal',
      noiseLevel: 'clean',
    }),
    minAccuracy: 0.90,
  },
  {
    name: 'noisy_environment',
    description: 'Speech recognition in noisy conditions',
    samples: createSamplesFromTranscripts(REFERENCE_TRANSCRIPTS.SHORT_PHRASES, {
      category: 'short_phrase',
      accent: 'us_standard',
      speed: 'normal',
      noiseLevel: 'medium',
    }),
    minAccuracy: 0.80,
  },
  {
    name: 'fast_speech',
    description: 'Fast-paced speech recognition',
    samples: createSamplesFromTranscripts(REFERENCE_TRANSCRIPTS.SENTENCES, {
      category: 'sentence',
      accent: 'us_standard',
      speed: 'fast',
      noiseLevel: 'clean',
    }),
    minAccuracy: 0.85,
  },
  {
    name: 'voice_commands',
    description: 'Atlas-specific voice commands',
    samples: createSamplesFromTranscripts(REFERENCE_TRANSCRIPTS.COMMANDS, {
      category: 'commands',
      accent: 'us_standard',
      speed: 'normal',
      noiseLevel: 'clean',
    }),
    minAccuracy: 0.95,
  },
  {
    name: 'conversational',
    description: 'Natural conversational speech with filler words',
    samples: createSamplesFromTranscripts(REFERENCE_TRANSCRIPTS.CONVERSATIONAL, {
      category: 'conversational',
      accent: 'us_standard',
      speed: 'normal',
      noiseLevel: 'clean',
    }),
    minAccuracy: 0.75,
  },
  {
    name: 'challenging_cases',
    description: 'Edge cases including homophones and unusual words',
    samples: [
      ...createSamplesFromTranscripts(CHALLENGING_TRANSCRIPTS.HOMOPHONES, {
        category: 'sentence',
        accent: 'us_standard',
        speed: 'normal',
        noiseLevel: 'clean',
      }),
      ...createSamplesFromTranscripts(CHALLENGING_TRANSCRIPTS.UNUSUAL_WORDS, {
        category: 'technical',
        accent: 'us_standard',
        speed: 'slow',
        noiseLevel: 'clean',
      }),
    ],
    minAccuracy: 0.70,
  },
];

/**
 * Helper function to create AudioSample objects from transcript list
 */
function createSamplesFromTranscripts(
  transcripts: ReadonlyArray<{ id: string; text: string; duration: number }>,
  options: {
    category: SampleCategory;
    accent: AccentType;
    speed: SpeechSpeed;
    noiseLevel: NoiseLevel;
  }
): AudioSample[] {
  return transcripts.map((t) => ({
    id: t.id,
    transcript: t.text,
    category: options.category,
    accent: options.accent,
    speed: options.speed,
    noiseLevel: options.noiseLevel,
    duration: t.duration,
    sampleRate: 16000,
  }));
}

/**
 * Get a test suite by name
 */
export function getTestSuite(name: string): TestSuite | undefined {
  return TEST_SUITES.find((suite) => suite.name === name);
}

/**
 * Get all samples across all suites
 */
export function getAllSamples(): AudioSample[] {
  return TEST_SUITES.flatMap((suite) => suite.samples);
}

/**
 * Filter samples by criteria
 */
export function filterSamples(criteria: {
  category?: SampleCategory;
  accent?: AccentType;
  speed?: SpeechSpeed;
  noiseLevel?: NoiseLevel;
}): AudioSample[] {
  return getAllSamples().filter((sample) => {
    if (criteria.category && sample.category !== criteria.category) return false;
    if (criteria.accent && sample.accent !== criteria.accent) return false;
    if (criteria.speed && sample.speed !== criteria.speed) return false;
    if (criteria.noiseLevel && sample.noiseLevel !== criteria.noiseLevel) return false;
    return true;
  });
}

export default {
  REFERENCE_TRANSCRIPTS,
  CHALLENGING_TRANSCRIPTS,
  TEST_SUITES,
  getTestSuite,
  getAllSamples,
  filterSamples,
};
