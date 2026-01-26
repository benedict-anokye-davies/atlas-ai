/**
 * Mock Response Fixtures Index
 * Centralized exports for all API mock response fixtures
 */

// Deepgram STT responses
export * from './deepgram';
export { default as deepgramResponses } from './deepgram';

// ElevenLabs TTS responses
export * from './elevenlabs';
export { default as elevenlabsResponses } from './elevenlabs';

// LLM responses (Fireworks, OpenRouter)
export * from './llm';
export { default as llmResponses } from './llm';
