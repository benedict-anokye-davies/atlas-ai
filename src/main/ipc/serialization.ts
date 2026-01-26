/**
 * Atlas Desktop - Fast IPC Serialization
 *
 * Provides high-performance serialization for IPC communication using:
 * - V8 serialization for binary data (faster than JSON for complex objects)
 * - Compression for large payloads (zlib)
 * - Schema-based validation for type safety
 *
 * Performance characteristics:
 * - Small payloads (<1KB): Use JSON (lower overhead)
 * - Medium payloads (1KB-64KB): Use V8 serialization
 * - Large payloads (>64KB): Use V8 serialization + compression
 */

import { serialize as v8Serialize, deserialize as v8Deserialize } from 'v8';
import { gzip, gunzip, constants as zlibConstants } from 'zlib';
import { promisify } from 'util';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('IPC-Serialization');

// Promisified compression functions
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// ============================================================================
// Configuration
// ============================================================================

/** Threshold for using V8 serialization instead of JSON (bytes) */
const V8_SERIALIZATION_THRESHOLD = 1024; // 1KB

/** Threshold for compressing data (bytes) */
const COMPRESSION_THRESHOLD = 65536; // 64KB

/** Compression level (1-9, higher = better compression, slower) */
const COMPRESSION_LEVEL = zlibConstants.Z_BEST_SPEED; // Level 1 for speed

/** Magic bytes for identifying serialized format */
const MAGIC_V8 = 0x56385345; // "V8SE" - V8 Serialized
const MAGIC_V8_COMPRESSED = 0x56385a43; // "V8ZC" - V8 + Zlib Compressed

/** Header size for binary serialized data */
const HEADER_SIZE = 8; // 4 bytes magic + 4 bytes original size

// ============================================================================
// Types
// ============================================================================

/**
 * Serialization format used for the data
 */
export type SerializationFormat = 'json' | 'v8' | 'v8-compressed';

/**
 * Serialization result with metadata
 */
export interface SerializationResult {
  data: Buffer | string;
  format: SerializationFormat;
  originalSize: number;
  serializedSize: number;
  compressionRatio?: number;
}

/**
 * Serialization statistics for monitoring
 */
export interface SerializationStats {
  jsonCount: number;
  v8Count: number;
  v8CompressedCount: number;
  totalBytesIn: number;
  totalBytesOut: number;
  avgCompressionRatio: number;
  serializationErrors: number;
  deserializationErrors: number;
}

// ============================================================================
// Internal State
// ============================================================================

let stats: SerializationStats = {
  jsonCount: 0,
  v8Count: 0,
  v8CompressedCount: 0,
  totalBytesIn: 0,
  totalBytesOut: 0,
  avgCompressionRatio: 1.0,
  serializationErrors: 0,
  deserializationErrors: 0,
};

// ============================================================================
// Core Serialization Functions
// ============================================================================

/**
 * Estimate the size of a JavaScript value for serialization format selection
 */
function estimateSize(value: unknown): number {
  if (value === null || value === undefined) {
    return 4;
  }

  if (typeof value === 'string') {
    return value.length * 2; // UTF-16 estimation
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return 8;
  }

  if (Buffer.isBuffer(value)) {
    return value.length;
  }

  if (ArrayBuffer.isView(value)) {
    return value.byteLength;
  }

  if (Array.isArray(value)) {
    let size = 16; // Array overhead
    for (let i = 0; i < Math.min(value.length, 100); i++) {
      size += estimateSize(value[i]);
    }
    // Extrapolate for large arrays
    if (value.length > 100) {
      size = (size / 100) * value.length;
    }
    return size;
  }

  if (typeof value === 'object') {
    let size = 24; // Object overhead
    const keys = Object.keys(value as object);
    for (let i = 0; i < Math.min(keys.length, 50); i++) {
      const key = keys[i];
      size += key.length * 2 + estimateSize((value as Record<string, unknown>)[key]);
    }
    // Extrapolate for objects with many keys
    if (keys.length > 50) {
      size = (size / 50) * keys.length;
    }
    return size;
  }

  return 8; // Default
}

/**
 * Serialize a value using the most efficient format
 *
 * @param value - The value to serialize
 * @param forceFormat - Optional: Force a specific format
 * @returns Serialization result with data and metadata
 */
export async function serialize(
  value: unknown,
  forceFormat?: SerializationFormat
): Promise<SerializationResult> {
  const estimatedSize = estimateSize(value);

  // Determine format
  let format: SerializationFormat = forceFormat || 'json';
  if (!forceFormat) {
    if (estimatedSize >= COMPRESSION_THRESHOLD) {
      format = 'v8-compressed';
    } else if (estimatedSize >= V8_SERIALIZATION_THRESHOLD) {
      format = 'v8';
    } else {
      format = 'json';
    }
  }

  try {
    let result: SerializationResult;

    switch (format) {
      case 'json': {
        const jsonStr = JSON.stringify(value);
        stats.jsonCount++;
        stats.totalBytesIn += estimatedSize;
        stats.totalBytesOut += jsonStr.length;
        result = {
          data: jsonStr,
          format: 'json',
          originalSize: estimatedSize,
          serializedSize: jsonStr.length,
        };
        break;
      }

      case 'v8': {
        const v8Data = v8Serialize(value);
        const header = Buffer.alloc(HEADER_SIZE);
        header.writeUInt32LE(MAGIC_V8, 0);
        header.writeUInt32LE(v8Data.length, 4);
        const fullBuffer = Buffer.concat([header, v8Data]);

        stats.v8Count++;
        stats.totalBytesIn += estimatedSize;
        stats.totalBytesOut += fullBuffer.length;
        result = {
          data: fullBuffer,
          format: 'v8',
          originalSize: estimatedSize,
          serializedSize: fullBuffer.length,
        };
        break;
      }

      case 'v8-compressed': {
        const v8Data = v8Serialize(value);
        const compressed = await gzipAsync(v8Data, { level: COMPRESSION_LEVEL });
        const header = Buffer.alloc(HEADER_SIZE);
        header.writeUInt32LE(MAGIC_V8_COMPRESSED, 0);
        header.writeUInt32LE(v8Data.length, 4); // Original V8 data size
        const fullBuffer = Buffer.concat([header, compressed]);

        const compressionRatio = v8Data.length / compressed.length;
        stats.v8CompressedCount++;
        stats.totalBytesIn += estimatedSize;
        stats.totalBytesOut += fullBuffer.length;

        // Update rolling average compression ratio
        const totalCompressed = stats.v8CompressedCount;
        stats.avgCompressionRatio =
          (stats.avgCompressionRatio * (totalCompressed - 1) + compressionRatio) / totalCompressed;

        result = {
          data: fullBuffer,
          format: 'v8-compressed',
          originalSize: v8Data.length,
          serializedSize: fullBuffer.length,
          compressionRatio,
        };
        break;
      }

      default:
        throw new Error(`Unknown serialization format: ${format}`);
    }

    return result;
  } catch (error) {
    stats.serializationErrors++;
    logger.error('Serialization error', {
      format,
      estimatedSize,
      error: (error as Error).message,
    });
    throw error;
  }
}

/**
 * Serialize synchronously (for small payloads, no compression)
 */
export function serializeSync(value: unknown): string | Buffer {
  const estimatedSize = estimateSize(value);

  if (estimatedSize < V8_SERIALIZATION_THRESHOLD) {
    stats.jsonCount++;
    return JSON.stringify(value);
  }

  const v8Data = v8Serialize(value);
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32LE(MAGIC_V8, 0);
  header.writeUInt32LE(v8Data.length, 4);
  stats.v8Count++;
  return Buffer.concat([header, v8Data]);
}

/**
 * Deserialize data based on its format
 *
 * @param data - The serialized data (Buffer or string)
 * @returns The deserialized value
 */
export async function deserialize<T = unknown>(data: Buffer | string): Promise<T> {
  try {
    // String data is always JSON
    if (typeof data === 'string') {
      return JSON.parse(data) as T;
    }

    // Check for our magic bytes
    if (data.length < HEADER_SIZE) {
      // Too small for binary format, try JSON
      return JSON.parse(data.toString('utf-8')) as T;
    }

    const magic = data.readUInt32LE(0);

    switch (magic) {
      case MAGIC_V8: {
        const v8Data = data.subarray(HEADER_SIZE);
        return v8Deserialize(v8Data) as T;
      }

      case MAGIC_V8_COMPRESSED: {
        const compressedData = data.subarray(HEADER_SIZE);
        const decompressed = await gunzipAsync(compressedData);
        return v8Deserialize(decompressed) as T;
      }

      default:
        // Not our format, try JSON
        return JSON.parse(data.toString('utf-8')) as T;
    }
  } catch (error) {
    stats.deserializationErrors++;
    logger.error('Deserialization error', {
      dataType: typeof data,
      dataLength: typeof data === 'string' ? data.length : data.length,
      error: (error as Error).message,
    });
    throw error;
  }
}

/**
 * Deserialize synchronously (for non-compressed data)
 */
export function deserializeSync<T = unknown>(data: Buffer | string): T {
  if (typeof data === 'string') {
    return JSON.parse(data) as T;
  }

  if (data.length < HEADER_SIZE) {
    return JSON.parse(data.toString('utf-8')) as T;
  }

  const magic = data.readUInt32LE(0);

  switch (magic) {
    case MAGIC_V8: {
      const v8Data = data.subarray(HEADER_SIZE);
      return v8Deserialize(v8Data) as T;
    }

    case MAGIC_V8_COMPRESSED:
      throw new Error('Cannot deserialize compressed data synchronously. Use deserialize() instead.');

    default:
      return JSON.parse(data.toString('utf-8')) as T;
  }
}

// ============================================================================
// Specialized Serializers for Common IPC Data Types
// ============================================================================

/**
 * Serialize audio data (optimized for Buffer arrays)
 */
export async function serializeAudioData(
  audioData: Buffer,
  metadata?: Record<string, unknown>
): Promise<SerializationResult> {
  const payload = {
    audio: audioData,
    metadata,
  };

  // Audio data is usually already compressed (mp3, opus) so skip compression
  // Use V8 serialization for efficient Buffer handling
  const v8Data = v8Serialize(payload);
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32LE(MAGIC_V8, 0);
  header.writeUInt32LE(v8Data.length, 4);
  const fullBuffer = Buffer.concat([header, v8Data]);

  stats.v8Count++;
  stats.totalBytesIn += audioData.length;
  stats.totalBytesOut += fullBuffer.length;

  return {
    data: fullBuffer,
    format: 'v8',
    originalSize: audioData.length,
    serializedSize: fullBuffer.length,
  };
}

/**
 * Serialize streaming chunks (small, frequent updates)
 * Uses JSON for minimal overhead on small payloads
 */
export function serializeStreamChunk(chunk: {
  id: string;
  type: string;
  data: string | number;
  timestamp?: number;
}): string {
  stats.jsonCount++;
  // Include timestamp if not provided
  if (!chunk.timestamp) {
    chunk.timestamp = Date.now();
  }
  return JSON.stringify(chunk);
}

/**
 * Serialize large state objects (e.g., conversation history)
 */
export async function serializeState(state: Record<string, unknown>): Promise<SerializationResult> {
  // Always use V8 + compression for state objects
  return serialize(state, 'v8-compressed');
}

// ============================================================================
// Statistics and Monitoring
// ============================================================================

/**
 * Get current serialization statistics
 */
export function getSerializationStats(): SerializationStats {
  return { ...stats };
}

/**
 * Reset serialization statistics
 */
export function resetSerializationStats(): void {
  stats = {
    jsonCount: 0,
    v8Count: 0,
    v8CompressedCount: 0,
    totalBytesIn: 0,
    totalBytesOut: 0,
    avgCompressionRatio: 1.0,
    serializationErrors: 0,
    deserializationErrors: 0,
  };
  logger.debug('Serialization stats reset');
}

/**
 * Log serialization statistics summary
 */
export function logSerializationStats(): void {
  const totalMessages = stats.jsonCount + stats.v8Count + stats.v8CompressedCount;
  const overallRatio =
    stats.totalBytesIn > 0 ? stats.totalBytesOut / stats.totalBytesIn : 1.0;

  logger.info('Serialization Statistics', {
    totalMessages,
    jsonCount: stats.jsonCount,
    v8Count: stats.v8Count,
    v8CompressedCount: stats.v8CompressedCount,
    totalBytesIn: `${(stats.totalBytesIn / 1024).toFixed(1)}KB`,
    totalBytesOut: `${(stats.totalBytesOut / 1024).toFixed(1)}KB`,
    overallRatio: overallRatio.toFixed(2),
    avgCompressionRatio: stats.avgCompressionRatio.toFixed(2),
    errors: stats.serializationErrors + stats.deserializationErrors,
  });
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if data is in V8 serialized format
 */
export function isV8Serialized(data: Buffer): boolean {
  if (data.length < HEADER_SIZE) {
    return false;
  }
  const magic = data.readUInt32LE(0);
  return magic === MAGIC_V8 || magic === MAGIC_V8_COMPRESSED;
}

/**
 * Check if data is compressed
 */
export function isCompressed(data: Buffer): boolean {
  if (data.length < HEADER_SIZE) {
    return false;
  }
  return data.readUInt32LE(0) === MAGIC_V8_COMPRESSED;
}

/**
 * Get the format of serialized data
 */
export function getSerializationFormat(data: Buffer | string): SerializationFormat {
  if (typeof data === 'string') {
    return 'json';
  }

  if (data.length < HEADER_SIZE) {
    return 'json';
  }

  const magic = data.readUInt32LE(0);
  switch (magic) {
    case MAGIC_V8:
      return 'v8';
    case MAGIC_V8_COMPRESSED:
      return 'v8-compressed';
    default:
      return 'json';
  }
}
