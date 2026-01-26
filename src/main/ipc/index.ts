/**
 * Atlas Desktop - IPC Module
 * Exports IPC handler registration and utilities
 */

export { registerIPCHandlers, unregisterIPCHandlers, setMainWindow, cleanupIPC } from './handlers';
export {
  IPCResult,
  success,
  failure,
  createAsyncHandler,
  createSyncHandler,
  createResourceHandler,
  removeHandlers,
  registerHandlers,
} from './factory';

// Optimized IPC channel
export {
  OptimizedIPCChannel,
  MessagePriority,
  getOptimizedIPCChannel,
  createOptimizedIPCChannel,
  shutdownOptimizedIPCChannel,
  ATLAS_CHANNELS,
  type IPCMessage,
  type BatchedMessages,
  type ChannelConfig,
  type LatencyMeasurement,
  type IPCMetrics,
} from './optimized-channel';

// Fast serialization
export {
  serialize,
  deserialize,
  serializeSync,
  deserializeSync,
  serializeAudioData,
  serializeStreamChunk,
  serializeState,
  getSerializationStats,
  resetSerializationStats,
  logSerializationStats,
  isV8Serialized,
  isCompressed,
  getSerializationFormat,
  type SerializationFormat,
  type SerializationResult,
  type SerializationStats,
} from './serialization';
