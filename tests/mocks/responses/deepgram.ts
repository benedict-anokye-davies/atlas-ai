/**
 * Deepgram API Mock Response Fixtures
 * Pre-configured responses for testing STT functionality
 */

// ============================================================================
// Types
// ============================================================================

export interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  punctuated_word?: string;
}

export interface DeepgramAlternative {
  transcript: string;
  confidence: number;
  words: DeepgramWord[];
}

export interface DeepgramChannel {
  alternatives: DeepgramAlternative[];
}

export interface DeepgramTranscriptionResponse {
  metadata: {
    request_id: string;
    created: string;
    duration: number;
    channels: number;
    model?: string;
    sha256?: string;
  };
  results: {
    channels: DeepgramChannel[];
  };
}

export interface DeepgramLiveTranscriptionEvent {
  type: 'Results' | 'Metadata' | 'SpeechStarted' | 'UtteranceEnd';
  channel?: DeepgramChannel;
  channel_index?: number[];
  is_final?: boolean;
  speech_final?: boolean;
  duration?: number;
  start?: number;
  from_finalize?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create word-level timing data from text
 */
function createWordTimings(text: string, startTime = 0, avgWordDuration = 0.3): DeepgramWord[] {
  const words = text.split(' ').filter((w) => w.length > 0);
  let currentTime = startTime;

  return words.map((word) => {
    const duration = avgWordDuration * (0.8 + Math.random() * 0.4);
    const wordData: DeepgramWord = {
      word: word.toLowerCase().replace(/[.,!?]/g, ''),
      start: currentTime,
      end: currentTime + duration,
      confidence: 0.9 + Math.random() * 0.1,
      punctuated_word: word,
    };
    currentTime += duration + 0.05; // Small gap between words
    return wordData;
  });
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

// ============================================================================
// Pre-configured Transcription Responses
// ============================================================================

/**
 * Simple greeting transcription
 */
export const GREETING_RESPONSE: DeepgramTranscriptionResponse = {
  metadata: {
    request_id: generateRequestId(),
    created: new Date().toISOString(),
    duration: 1.2,
    channels: 1,
    model: 'nova-2',
  },
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: 'Hello Atlas.',
            confidence: 0.97,
            words: createWordTimings('Hello Atlas.'),
          },
        ],
      },
    ],
  },
};

/**
 * Question transcription
 */
export const QUESTION_RESPONSE: DeepgramTranscriptionResponse = {
  metadata: {
    request_id: generateRequestId(),
    created: new Date().toISOString(),
    duration: 2.5,
    channels: 1,
    model: 'nova-2',
  },
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: 'What is the weather like today?',
            confidence: 0.95,
            words: createWordTimings('What is the weather like today?'),
          },
        ],
      },
    ],
  },
};

/**
 * Command transcription
 */
export const COMMAND_RESPONSE: DeepgramTranscriptionResponse = {
  metadata: {
    request_id: generateRequestId(),
    created: new Date().toISOString(),
    duration: 3.0,
    channels: 1,
    model: 'nova-2',
  },
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: 'Open the browser and search for Python tutorials.',
            confidence: 0.94,
            words: createWordTimings('Open the browser and search for Python tutorials.'),
          },
        ],
      },
    ],
  },
};

/**
 * Complex multi-sentence transcription
 */
export const COMPLEX_RESPONSE: DeepgramTranscriptionResponse = {
  metadata: {
    request_id: generateRequestId(),
    created: new Date().toISOString(),
    duration: 8.5,
    channels: 1,
    model: 'nova-2',
  },
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript:
              'I need you to help me with my project. First, create a new folder called documents, then copy the report file into it.',
            confidence: 0.92,
            words: createWordTimings(
              'I need you to help me with my project. First, create a new folder called documents, then copy the report file into it.'
            ),
          },
        ],
      },
    ],
  },
};

/**
 * Low confidence transcription (noisy audio)
 */
export const LOW_CONFIDENCE_RESPONSE: DeepgramTranscriptionResponse = {
  metadata: {
    request_id: generateRequestId(),
    created: new Date().toISOString(),
    duration: 2.0,
    channels: 1,
    model: 'nova-2',
  },
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: 'Can you hear me now?',
            confidence: 0.65,
            words: createWordTimings('Can you hear me now?').map((w) => ({
              ...w,
              confidence: 0.55 + Math.random() * 0.2,
            })),
          },
        ],
      },
    ],
  },
};

/**
 * Empty transcription (silence)
 */
export const SILENCE_RESPONSE: DeepgramTranscriptionResponse = {
  metadata: {
    request_id: generateRequestId(),
    created: new Date().toISOString(),
    duration: 0.5,
    channels: 1,
    model: 'nova-2',
  },
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: '',
            confidence: 0,
            words: [],
          },
        ],
      },
    ],
  },
};

// ============================================================================
// Live Transcription Events (WebSocket)
// ============================================================================

/**
 * Create a live transcription result event
 */
export function createLiveTranscriptionEvent(
  transcript: string,
  options: {
    isFinal?: boolean;
    speechFinal?: boolean;
    startTime?: number;
    duration?: number;
  } = {}
): DeepgramLiveTranscriptionEvent {
  const { isFinal = true, speechFinal = true, startTime = 0, duration } = options;

  const words = createWordTimings(transcript, startTime);
  const calculatedDuration = duration ?? words.length * 0.35;

  return {
    type: 'Results',
    channel: {
      alternatives: [
        {
          transcript,
          confidence: 0.95,
          words,
        },
      ],
    },
    channel_index: [0, 1],
    is_final: isFinal,
    speech_final: speechFinal,
    duration: calculatedDuration,
    start: startTime,
    from_finalize: false,
  };
}

/**
 * Create an interim (non-final) transcription event
 */
export function createInterimEvent(transcript: string, startTime = 0): DeepgramLiveTranscriptionEvent {
  return createLiveTranscriptionEvent(transcript, {
    isFinal: false,
    speechFinal: false,
    startTime,
  });
}

/**
 * Create a final transcription event
 */
export function createFinalEvent(transcript: string, startTime = 0): DeepgramLiveTranscriptionEvent {
  return createLiveTranscriptionEvent(transcript, {
    isFinal: true,
    speechFinal: true,
    startTime,
  });
}

/**
 * Create a speech started event
 */
export function createSpeechStartedEvent(): DeepgramLiveTranscriptionEvent {
  return {
    type: 'SpeechStarted',
    channel_index: [0],
  };
}

/**
 * Create an utterance end event
 */
export function createUtteranceEndEvent(): DeepgramLiveTranscriptionEvent {
  return {
    type: 'UtteranceEnd',
    channel_index: [0],
  };
}

/**
 * Create a metadata event
 */
export function createMetadataEvent(model = 'nova-2'): DeepgramLiveTranscriptionEvent {
  return {
    type: 'Metadata',
    channel_index: [0],
  };
}

/**
 * Create a sequence of events simulating real-time transcription
 */
export function createTranscriptionSequence(
  finalText: string,
  options: {
    includeInterim?: boolean;
    interimCount?: number;
  } = {}
): DeepgramLiveTranscriptionEvent[] {
  const { includeInterim = true, interimCount = 3 } = options;
  const events: DeepgramLiveTranscriptionEvent[] = [];

  // Speech started
  events.push(createSpeechStartedEvent());

  if (includeInterim) {
    // Generate interim results
    const words = finalText.split(' ');
    const wordsPerInterim = Math.ceil(words.length / interimCount);

    for (let i = 1; i <= interimCount; i++) {
      const partialWords = words.slice(0, i * wordsPerInterim);
      const partialText = partialWords.join(' ');
      events.push(createInterimEvent(partialText, 0));
    }
  }

  // Final result
  events.push(createFinalEvent(finalText, 0));

  // Utterance end
  events.push(createUtteranceEndEvent());

  return events;
}

// ============================================================================
// Error Responses
// ============================================================================

export interface DeepgramErrorResponse {
  err_code: string;
  err_msg: string;
  request_id?: string;
}

/**
 * Invalid API key error
 */
export const INVALID_API_KEY_ERROR: DeepgramErrorResponse = {
  err_code: 'INVALID_AUTH',
  err_msg: 'The provided API key is invalid or has been revoked.',
  request_id: generateRequestId(),
};

/**
 * Rate limit error
 */
export const RATE_LIMIT_ERROR: DeepgramErrorResponse = {
  err_code: 'RATE_LIMIT_EXCEEDED',
  err_msg: 'You have exceeded the rate limit. Please wait before making additional requests.',
  request_id: generateRequestId(),
};

/**
 * Invalid audio error
 */
export const INVALID_AUDIO_ERROR: DeepgramErrorResponse = {
  err_code: 'INVALID_AUDIO',
  err_msg: 'The provided audio data is invalid or in an unsupported format.',
  request_id: generateRequestId(),
};

/**
 * Service unavailable error
 */
export const SERVICE_UNAVAILABLE_ERROR: DeepgramErrorResponse = {
  err_code: 'SERVICE_UNAVAILABLE',
  err_msg: 'The Deepgram service is temporarily unavailable. Please try again later.',
  request_id: generateRequestId(),
};

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a custom transcription response
 */
export function createTranscriptionResponse(
  transcript: string,
  options: {
    confidence?: number;
    duration?: number;
    model?: string;
  } = {}
): DeepgramTranscriptionResponse {
  const { confidence = 0.95, duration, model = 'nova-2' } = options;

  const words = createWordTimings(transcript);
  const calculatedDuration = duration ?? words.length * 0.35;

  return {
    metadata: {
      request_id: generateRequestId(),
      created: new Date().toISOString(),
      duration: calculatedDuration,
      channels: 1,
      model,
    },
    results: {
      channels: [
        {
          alternatives: [
            {
              transcript,
              confidence,
              words,
            },
          ],
        },
      ],
    },
  };
}

/**
 * Create a multi-channel transcription response (for diarization)
 */
export function createMultiChannelResponse(
  transcripts: string[],
  options: {
    confidence?: number;
    model?: string;
  } = {}
): DeepgramTranscriptionResponse {
  const { confidence = 0.95, model = 'nova-2' } = options;

  const channels: DeepgramChannel[] = transcripts.map((transcript) => ({
    alternatives: [
      {
        transcript,
        confidence,
        words: createWordTimings(transcript),
      },
    ],
  }));

  const totalDuration = channels.reduce(
    (sum, ch) => sum + ch.alternatives[0].words.length * 0.35,
    0
  );

  return {
    metadata: {
      request_id: generateRequestId(),
      created: new Date().toISOString(),
      duration: totalDuration,
      channels: channels.length,
      model,
    },
    results: { channels },
  };
}

export default {
  GREETING_RESPONSE,
  QUESTION_RESPONSE,
  COMMAND_RESPONSE,
  COMPLEX_RESPONSE,
  LOW_CONFIDENCE_RESPONSE,
  SILENCE_RESPONSE,
  INVALID_API_KEY_ERROR,
  RATE_LIMIT_ERROR,
  INVALID_AUDIO_ERROR,
  SERVICE_UNAVAILABLE_ERROR,
  createTranscriptionResponse,
  createMultiChannelResponse,
  createLiveTranscriptionEvent,
  createInterimEvent,
  createFinalEvent,
  createSpeechStartedEvent,
  createUtteranceEndEvent,
  createMetadataEvent,
  createTranscriptionSequence,
};
