/**
 * Conversation Test Fixtures
 * Sample conversation data for testing LLM and memory components
 */

/**
 * Simple Q&A conversation
 */
export const SIMPLE_CONVERSATION = [
  { role: 'user' as const, content: 'What is the capital of France?' },
  { role: 'assistant' as const, content: 'The capital of France is Paris.' },
];

/**
 * Multi-turn conversation
 */
export const MULTI_TURN_CONVERSATION = [
  { role: 'user' as const, content: 'I need help with Python.' },
  { role: 'assistant' as const, content: 'I would be happy to help you with Python! What would you like to know?' },
  { role: 'user' as const, content: 'How do I read a file?' },
  {
    role: 'assistant' as const,
    content:
      'To read a file in Python, you can use the open() function with a context manager. Here is an example:\n\nwith open("filename.txt", "r") as file:\n    content = file.read()',
  },
  { role: 'user' as const, content: 'What about writing to a file?' },
  {
    role: 'assistant' as const,
    content:
      'To write to a file, use the "w" mode instead:\n\nwith open("filename.txt", "w") as file:\n    file.write("Hello, World!")',
  },
];

/**
 * Conversation with tool use
 */
export const TOOL_USE_CONVERSATION = [
  { role: 'user' as const, content: 'Search for the weather in Seattle' },
  {
    role: 'assistant' as const,
    content: 'I will search for the current weather in Seattle.',
    toolCalls: [
      {
        id: 'call_1',
        type: 'function' as const,
        function: {
          name: 'web_search',
          arguments: JSON.stringify({ query: 'weather in Seattle' }),
        },
      },
    ],
  },
  {
    role: 'tool' as const,
    content: JSON.stringify({
      results: [
        {
          title: 'Seattle Weather',
          snippet: 'Current conditions: 55°F, Partly Cloudy. High: 62°F, Low: 48°F',
        },
      ],
    }),
    toolCallId: 'call_1',
  },
  {
    role: 'assistant' as const,
    content:
      'The current weather in Seattle is 55°F and partly cloudy. The high today will be 62°F and the low will be 48°F.',
  },
];

/**
 * Conversation with context retention
 */
export const CONTEXT_CONVERSATION = [
  { role: 'user' as const, content: 'My name is Alice.' },
  { role: 'assistant' as const, content: 'Nice to meet you, Alice! How can I help you today?' },
  { role: 'user' as const, content: 'What was my name again?' },
  { role: 'assistant' as const, content: 'Your name is Alice.' },
];

/**
 * Creates a conversation context object
 */
export function createConversation(options: {
  userName?: string;
  messages?: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }>;
} = {}) {
  const { userName = 'User', messages = [] } = options;

  return {
    id: `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    userName,
    messages,
    totalTokens: messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0),
    startTime: Date.now() - messages.length * 5000, // Assume 5s between messages
  };
}

/**
 * Sample LLM responses for testing
 */
export const SAMPLE_RESPONSES = {
  greeting: "Hello! I'm Nova, your AI assistant. How can I help you today?",
  affirmative: "Of course! I'd be happy to help with that.",
  clarification: "Could you please provide more details about what you need?",
  error: "I'm sorry, but I encountered an error processing your request. Could you try again?",
  toolUse: 'Let me search for that information for you.',
  summary: 'To summarize, the key points are:',
};

/**
 * Creates a mock LLM response
 */
export function createLLMResponse(
  content: string,
  options: {
    finishReason?: string;
    promptTokens?: number;
    completionTokens?: number;
  } = {}
) {
  const { finishReason = 'stop', promptTokens = 50, completionTokens = Math.ceil(content.length / 4) } = options;

  return {
    content,
    finishReason,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
    model: 'accounts/fireworks/models/deepseek-r1',
  };
}

/**
 * Creates mock streaming chunks
 */
export function createStreamingChunks(content: string, chunkSize = 5): string[] {
  const words = content.split(' ');
  const chunks: string[] = [];

  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    chunks.push(chunk + (i + chunkSize < words.length ? ' ' : ''));
  }

  return chunks;
}
