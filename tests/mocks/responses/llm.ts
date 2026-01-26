/**
 * LLM API Mock Response Fixtures
 * Pre-configured responses for testing Fireworks AI and OpenRouter LLM functionality
 */

// ============================================================================
// Types (OpenAI-compatible format)
// ============================================================================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: ChatCompletionUsage;
  system_fingerprint?: string;
}

export interface ChatCompletionStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
  usage?: ChatCompletionUsage;
}

export interface LLMModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  permission?: unknown[];
  root?: string;
  parent?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique completion ID
 */
function generateCompletionId(prefix = 'chatcmpl'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Estimate token count (rough approximation)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Get current Unix timestamp
 */
function getTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

// ============================================================================
// Fireworks AI Models
// ============================================================================

export const FIREWORKS_MODELS: LLMModel[] = [
  {
    id: 'accounts/fireworks/models/deepseek-r1',
    object: 'model',
    created: getTimestamp() - 86400 * 30,
    owned_by: 'fireworks',
  },
  {
    id: 'accounts/fireworks/models/llama-v3p1-405b-instruct',
    object: 'model',
    created: getTimestamp() - 86400 * 60,
    owned_by: 'fireworks',
  },
  {
    id: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
    object: 'model',
    created: getTimestamp() - 86400 * 60,
    owned_by: 'fireworks',
  },
  {
    id: 'accounts/fireworks/models/mixtral-8x7b-instruct',
    object: 'model',
    created: getTimestamp() - 86400 * 90,
    owned_by: 'fireworks',
  },
];

// ============================================================================
// OpenRouter Models
// ============================================================================

export interface OpenRouterModel {
  id: string;
  name: string;
  pricing: {
    prompt: string;
    completion: string;
  };
  context_length: number;
  architecture?: {
    modality: string;
    tokenizer: string;
    instruct_type?: string;
  };
  top_provider?: {
    context_length: number;
    max_completion_tokens?: number;
    is_moderated?: boolean;
  };
  per_request_limits?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export const OPENROUTER_MODELS: OpenRouterModel[] = [
  {
    id: 'anthropic/claude-3-haiku',
    name: 'Claude 3 Haiku',
    pricing: { prompt: '0.00025', completion: '0.00125' },
    context_length: 200000,
    architecture: {
      modality: 'text->text',
      tokenizer: 'Claude',
      instruct_type: 'claude',
    },
  },
  {
    id: 'anthropic/claude-3-sonnet',
    name: 'Claude 3 Sonnet',
    pricing: { prompt: '0.003', completion: '0.015' },
    context_length: 200000,
    architecture: {
      modality: 'text->text',
      tokenizer: 'Claude',
      instruct_type: 'claude',
    },
  },
  {
    id: 'openai/gpt-4-turbo',
    name: 'GPT-4 Turbo',
    pricing: { prompt: '0.01', completion: '0.03' },
    context_length: 128000,
    architecture: {
      modality: 'text->text',
      tokenizer: 'GPT',
      instruct_type: 'chatgpt',
    },
  },
  {
    id: 'google/gemini-pro',
    name: 'Gemini Pro',
    pricing: { prompt: '0.000125', completion: '0.000375' },
    context_length: 32000,
    architecture: {
      modality: 'text->text',
      tokenizer: 'Gemini',
      instruct_type: 'gemini',
    },
  },
  {
    id: 'meta-llama/llama-3-70b-instruct',
    name: 'Llama 3 70B Instruct',
    pricing: { prompt: '0.0008', completion: '0.0008' },
    context_length: 8192,
    architecture: {
      modality: 'text->text',
      tokenizer: 'Llama',
      instruct_type: 'llama',
    },
  },
];

// ============================================================================
// Pre-configured Chat Responses
// ============================================================================

/**
 * Simple greeting response
 */
export const GREETING_RESPONSE: ChatCompletionResponse = {
  id: generateCompletionId(),
  object: 'chat.completion',
  created: getTimestamp(),
  model: 'accounts/fireworks/models/deepseek-r1',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: "Hello! I'm Atlas, your AI assistant. How can I help you today?",
      },
      finish_reason: 'stop',
    },
  ],
  usage: {
    prompt_tokens: 45,
    completion_tokens: 18,
    total_tokens: 63,
  },
};

/**
 * Weather query response
 */
export const WEATHER_RESPONSE: ChatCompletionResponse = {
  id: generateCompletionId(),
  object: 'chat.completion',
  created: getTimestamp(),
  model: 'accounts/fireworks/models/deepseek-r1',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content:
          "I'd be happy to help you check the weather! However, I'll need to use a web search tool to get the current weather information. Let me do that for you.",
      },
      finish_reason: 'stop',
    },
  ],
  usage: {
    prompt_tokens: 52,
    completion_tokens: 42,
    total_tokens: 94,
  },
};

/**
 * Help/capabilities response
 */
export const HELP_RESPONSE: ChatCompletionResponse = {
  id: generateCompletionId(),
  object: 'chat.completion',
  created: getTimestamp(),
  model: 'accounts/fireworks/models/deepseek-r1',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: `I'm Atlas, your AI desktop assistant. Here's what I can help you with:

1. **File Management** - Browse, create, edit, and organize files
2. **Web Search** - Search the internet for information
3. **Browser Automation** - Open websites and interact with web pages
4. **Terminal Commands** - Run system commands and scripts
5. **Screenshots** - Capture your screen
6. **Clipboard** - Read and write to your clipboard
7. **General Questions** - Answer questions and have conversations

Just ask me what you need help with!`,
      },
      finish_reason: 'stop',
    },
  ],
  usage: {
    prompt_tokens: 48,
    completion_tokens: 120,
    total_tokens: 168,
  },
};

/**
 * Code explanation response
 */
export const CODE_EXPLANATION_RESPONSE: ChatCompletionResponse = {
  id: generateCompletionId(),
  object: 'chat.completion',
  created: getTimestamp(),
  model: 'accounts/fireworks/models/deepseek-r1',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: `Here's an explanation of the code:

\`\`\`typescript
// This function calculates the factorial of a number
function factorial(n: number): number {
  if (n <= 1) return 1;  // Base case: factorial of 0 or 1 is 1
  return n * factorial(n - 1);  // Recursive case: n! = n * (n-1)!
}
\`\`\`

The function uses **recursion** - it calls itself with a smaller input until it reaches the base case. Time complexity is O(n) and space complexity is O(n) due to the call stack.`,
      },
      finish_reason: 'stop',
    },
  ],
  usage: {
    prompt_tokens: 85,
    completion_tokens: 145,
    total_tokens: 230,
  },
};

/**
 * Response with tool call (web search)
 */
export const TOOL_CALL_RESPONSE: ChatCompletionResponse = {
  id: generateCompletionId(),
  object: 'chat.completion',
  created: getTimestamp(),
  model: 'accounts/fireworks/models/deepseek-r1',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_' + Date.now(),
            type: 'function',
            function: {
              name: 'web_search',
              arguments: JSON.stringify({ query: 'current weather in New York' }),
            },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ],
  usage: {
    prompt_tokens: 65,
    completion_tokens: 32,
    total_tokens: 97,
  },
};

/**
 * Response with multiple tool calls
 */
export const MULTI_TOOL_CALL_RESPONSE: ChatCompletionResponse = {
  id: generateCompletionId(),
  object: 'chat.completion',
  created: getTimestamp(),
  model: 'accounts/fireworks/models/deepseek-r1',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1_' + Date.now(),
            type: 'function',
            function: {
              name: 'file_read',
              arguments: JSON.stringify({ path: '/home/user/document.txt' }),
            },
          },
          {
            id: 'call_2_' + Date.now(),
            type: 'function',
            function: {
              name: 'screenshot',
              arguments: JSON.stringify({}),
            },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ],
  usage: {
    prompt_tokens: 78,
    completion_tokens: 45,
    total_tokens: 123,
  },
};

/**
 * Long response (for testing streaming)
 */
export const LONG_RESPONSE: ChatCompletionResponse = {
  id: generateCompletionId(),
  object: 'chat.completion',
  created: getTimestamp(),
  model: 'accounts/fireworks/models/deepseek-r1',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: `# Introduction to Machine Learning

Machine learning is a subset of artificial intelligence that enables computers to learn from data without being explicitly programmed. Here are the main types:

## 1. Supervised Learning
In supervised learning, the algorithm learns from labeled training data. Common algorithms include:
- Linear Regression
- Decision Trees
- Support Vector Machines
- Neural Networks

## 2. Unsupervised Learning
Unsupervised learning finds patterns in unlabeled data:
- K-Means Clustering
- Hierarchical Clustering
- Principal Component Analysis

## 3. Reinforcement Learning
The algorithm learns by interacting with an environment:
- Q-Learning
- Policy Gradient Methods
- Actor-Critic Methods

## Getting Started
To get started with machine learning, I recommend:
1. Learn Python programming
2. Study linear algebra and statistics
3. Practice with scikit-learn library
4. Take online courses (Coursera, fast.ai)

Would you like me to explain any of these concepts in more detail?`,
      },
      finish_reason: 'stop',
    },
  ],
  usage: {
    prompt_tokens: 55,
    completion_tokens: 280,
    total_tokens: 335,
  },
};

// ============================================================================
// Streaming Response Generation
// ============================================================================

/**
 * Create streaming chunks from a complete response
 */
export function createStreamingChunks(
  content: string,
  options: {
    model?: string;
    chunkSize?: number;
    includeUsage?: boolean;
  } = {}
): ChatCompletionStreamChunk[] {
  const {
    model = 'accounts/fireworks/models/deepseek-r1',
    chunkSize = 10,
    includeUsage = false,
  } = options;

  const chunks: ChatCompletionStreamChunk[] = [];
  const id = generateCompletionId();
  const created = getTimestamp();

  // First chunk with role
  chunks.push({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [
      {
        index: 0,
        delta: { role: 'assistant', content: '' },
        finish_reason: null,
      },
    ],
  });

  // Content chunks
  for (let i = 0; i < content.length; i += chunkSize) {
    const chunkContent = content.slice(i, i + chunkSize);
    chunks.push({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [
        {
          index: 0,
          delta: { content: chunkContent },
          finish_reason: null,
        },
      ],
    });
  }

  // Final chunk
  chunks.push({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'stop',
      },
    ],
    usage: includeUsage
      ? {
          prompt_tokens: 50,
          completion_tokens: estimateTokens(content),
          total_tokens: 50 + estimateTokens(content),
        }
      : undefined,
  });

  return chunks;
}

/**
 * Create streaming chunks for a tool call response
 */
export function createToolCallStreamingChunks(
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
  options: {
    model?: string;
  } = {}
): ChatCompletionStreamChunk[] {
  const { model = 'accounts/fireworks/models/deepseek-r1' } = options;

  const chunks: ChatCompletionStreamChunk[] = [];
  const id = generateCompletionId();
  const created = getTimestamp();

  // First chunk with role
  chunks.push({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [
      {
        index: 0,
        delta: { role: 'assistant' },
        finish_reason: null,
      },
    ],
  });

  // Tool call chunks
  toolCalls.forEach((toolCall, index) => {
    const callId = `call_${Date.now()}_${index}`;
    const argsStr = JSON.stringify(toolCall.arguments);

    // Initial tool call info
    chunks.push({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index,
                id: callId,
                type: 'function',
                function: { name: toolCall.name },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });

    // Arguments in chunks
    for (let i = 0; i < argsStr.length; i += 20) {
      chunks.push({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index,
                  function: { arguments: argsStr.slice(i, i + 20) },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });
    }
  });

  // Final chunk
  chunks.push({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'tool_calls',
      },
    ],
  });

  return chunks;
}

/**
 * Convert streaming chunks to SSE format
 */
export function chunksToSSE(chunks: ChatCompletionStreamChunk[]): string {
  return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
}

// ============================================================================
// Error Responses
// ============================================================================

export interface LLMError {
  error: {
    message: string;
    type: string;
    code?: string;
    param?: string;
  };
}

/**
 * Invalid API key error
 */
export const INVALID_API_KEY_ERROR: LLMError = {
  error: {
    message: 'Invalid API key provided. Please check your API key and try again.',
    type: 'invalid_request_error',
    code: 'invalid_api_key',
  },
};

/**
 * Rate limit error
 */
export const RATE_LIMIT_ERROR: LLMError = {
  error: {
    message: 'Rate limit exceeded. Please wait before making additional requests.',
    type: 'rate_limit_error',
    code: 'rate_limit_exceeded',
  },
};

/**
 * Context length exceeded error
 */
export const CONTEXT_LENGTH_ERROR: LLMError = {
  error: {
    message: 'This model\'s maximum context length is 128000 tokens. Your request was 130000 tokens.',
    type: 'invalid_request_error',
    code: 'context_length_exceeded',
    param: 'messages',
  },
};

/**
 * Model not found error
 */
export const MODEL_NOT_FOUND_ERROR: LLMError = {
  error: {
    message: 'The model `invalid-model` does not exist.',
    type: 'invalid_request_error',
    code: 'model_not_found',
    param: 'model',
  },
};

/**
 * Service unavailable error
 */
export const SERVICE_UNAVAILABLE_ERROR: LLMError = {
  error: {
    message: 'The server is currently unavailable. Please try again later.',
    type: 'server_error',
    code: 'service_unavailable',
  },
};

/**
 * Content filter error
 */
export const CONTENT_FILTER_ERROR: LLMError = {
  error: {
    message: 'Your request was rejected as a result of our safety system.',
    type: 'invalid_request_error',
    code: 'content_filter',
  },
};

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a custom chat completion response
 */
export function createChatCompletion(
  content: string,
  options: {
    model?: string;
    finishReason?: ChatCompletionChoice['finish_reason'];
    toolCalls?: ToolCall[];
    promptTokens?: number;
  } = {}
): ChatCompletionResponse {
  const {
    model = 'accounts/fireworks/models/deepseek-r1',
    finishReason = 'stop',
    toolCalls,
    promptTokens = 50,
  } = options;

  const completionTokens = estimateTokens(content);

  return {
    id: generateCompletionId(),
    object: 'chat.completion',
    created: getTimestamp(),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
          tool_calls: toolCalls,
        },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

/**
 * Create a tool call response
 */
export function createToolCallCompletion(
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
  options: {
    model?: string;
    promptTokens?: number;
  } = {}
): ChatCompletionResponse {
  const { model = 'accounts/fireworks/models/deepseek-r1', promptTokens = 50 } = options;

  const formattedToolCalls: ToolCall[] = toolCalls.map((tc, i) => ({
    id: `call_${Date.now()}_${i}`,
    type: 'function',
    function: {
      name: tc.name,
      arguments: JSON.stringify(tc.arguments),
    },
  }));

  return {
    id: generateCompletionId(),
    object: 'chat.completion',
    created: getTimestamp(),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: '',
          tool_calls: formattedToolCalls,
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: 30,
      total_tokens: promptTokens + 30,
    },
  };
}

/**
 * Create a chat request body
 */
export function createChatRequest(
  messages: ChatMessage[],
  options: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    stream?: boolean;
    tools?: Array<{
      type: 'function';
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }>;
  } = {}
): Record<string, unknown> {
  const {
    model = 'accounts/fireworks/models/deepseek-r1',
    maxTokens = 2048,
    temperature = 0.7,
    stream = false,
    tools,
  } = options;

  const request: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
    stream,
  };

  if (tools) {
    request.tools = tools;
  }

  return request;
}

export default {
  // Models
  FIREWORKS_MODELS,
  OPENROUTER_MODELS,
  // Pre-configured responses
  GREETING_RESPONSE,
  WEATHER_RESPONSE,
  HELP_RESPONSE,
  CODE_EXPLANATION_RESPONSE,
  TOOL_CALL_RESPONSE,
  MULTI_TOOL_CALL_RESPONSE,
  LONG_RESPONSE,
  // Errors
  INVALID_API_KEY_ERROR,
  RATE_LIMIT_ERROR,
  CONTEXT_LENGTH_ERROR,
  MODEL_NOT_FOUND_ERROR,
  SERVICE_UNAVAILABLE_ERROR,
  CONTENT_FILTER_ERROR,
  // Factory functions
  createChatCompletion,
  createToolCallCompletion,
  createChatRequest,
  createStreamingChunks,
  createToolCallStreamingChunks,
  chunksToSSE,
};
