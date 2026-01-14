/**
 * Transcript Test Fixtures
 * Sample transcription data for testing STT components
 */

/**
 * Simple greeting transcripts
 */
export const GREETING_TRANSCRIPTS = [
  'hello',
  'hi there',
  'hey nova',
  'good morning',
  'good afternoon',
  'good evening',
];

/**
 * Question transcripts for testing queries
 */
export const QUESTION_TRANSCRIPTS = [
  'what time is it',
  'what is the weather like',
  'can you help me',
  'how do I open a file',
  'where are my documents',
  'when is my next meeting',
];

/**
 * Command transcripts for testing agent tools
 */
export const COMMAND_TRANSCRIPTS = [
  'open google chrome',
  'search for python tutorials',
  'create a new file',
  'take a screenshot',
  'run the build command',
  'commit my changes',
];

/**
 * Complex multi-sentence transcripts
 */
export const COMPLEX_TRANSCRIPTS = [
  'I need help with my code. Can you look at the main function and tell me what is wrong?',
  'Please search the web for react hooks tutorial and then summarize the first result.',
  'Open my documents folder and find the file called project notes from last week.',
];

/**
 * Creates a mock Deepgram transcript result
 */
export function createTranscriptResult(
  text: string,
  options: {
    isFinal?: boolean;
    confidence?: number;
    startTime?: number;
    duration?: number;
  } = {}
) {
  const { isFinal = true, confidence = 0.95, startTime = 0, duration = text.length * 0.1 } = options;

  const words = text.split(' ').map((word, i) => ({
    word,
    start: startTime + i * (duration / text.split(' ').length),
    end: startTime + (i + 1) * (duration / text.split(' ').length),
    confidence,
  }));

  return {
    channel: {
      alternatives: [
        {
          transcript: text,
          confidence,
          words,
        },
      ],
    },
    is_final: isFinal,
    speech_final: isFinal,
    start: startTime,
    duration,
  };
}

/**
 * Creates a sequence of interim transcripts leading to final
 */
export function createInterimTranscriptSequence(finalText: string) {
  const words = finalText.split(' ');
  const sequence = [];

  // Generate interim results showing progressive transcription
  for (let i = 1; i <= words.length; i++) {
    const partialText = words.slice(0, i).join(' ');
    sequence.push(
      createTranscriptResult(partialText, {
        isFinal: i === words.length,
        confidence: 0.85 + i * 0.02, // Confidence increases
      })
    );
  }

  return sequence;
}

/**
 * Sample transcript with timestamps for testing word-level alignment
 */
export const TIMESTAMPED_TRANSCRIPT = {
  text: 'hello nova how can you help me today',
  words: [
    { word: 'hello', start: 0.0, end: 0.4, confidence: 0.98 },
    { word: 'nova', start: 0.45, end: 0.8, confidence: 0.97 },
    { word: 'how', start: 0.9, end: 1.1, confidence: 0.96 },
    { word: 'can', start: 1.15, end: 1.35, confidence: 0.95 },
    { word: 'you', start: 1.4, end: 1.55, confidence: 0.97 },
    { word: 'help', start: 1.6, end: 1.85, confidence: 0.98 },
    { word: 'me', start: 1.9, end: 2.05, confidence: 0.99 },
    { word: 'today', start: 2.1, end: 2.5, confidence: 0.96 },
  ],
  duration: 2.5,
};
