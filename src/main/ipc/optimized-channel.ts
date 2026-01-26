/**
 * Atlas Desktop - Optimized IPC Channel
 *
 * High-performance IPC communication layer with:
 * - Message batching for high-frequency updates
 * - Priority-based message queuing
 * - Binary serialization for large payloads
 * - Latency monitoring and metrics
 * - Channel pooling for concurrent operations
 *
 * Performance targets:
 * - High-priority messages: <5ms latency
 * - Normal messages: <20ms latency (batched)
 * - Large payloads: Async with streaming support
 */

import { ipcMain, BrowserWindow, WebContents } from 'electron';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import {
  serialize,
  serializeStreamChunk,
  getSerializationStats,
  SerializationStats,
} from './serialization';

const logger = createModuleLogger('OptimizedIPC');

// ============================================================================
// Types
// ============================================================================

/**
 * Message priority levels
 */
export enum MessagePriority {
  /** Critical system messages, delivered immediately */
  CRITICAL = 0,
  /** High-priority user-facing updates (transcript, response chunks) */
  HIGH = 1,
  /** Normal priority (state changes, metrics) */
  NORMAL = 2,
  /** Low priority (analytics, background updates) */
  LOW = 3,
}

/**
 * Message envelope for IPC communication
 */
export interface IPCMessage<T = unknown> {
  id: string;
  channel: string;
  priority: MessagePriority;
  timestamp: number;
  payload: T;
  requiresAck?: boolean;
}

/**
 * Batched message container
 */
export interface BatchedMessages {
  batchId: string;
  messages: IPCMessage[];
  createdAt: number;
  priority: MessagePriority;
}

/**
 * Channel configuration
 */
export interface ChannelConfig {
  /** Channel name */
  name: string;
  /** Message priority */
  priority: MessagePriority;
  /** Whether to batch messages */
  batched: boolean;
  /** Batch interval in ms (only if batched=true) */
  batchInterval?: number;
  /** Max messages per batch */
  maxBatchSize?: number;
  /** Use binary serialization for large payloads */
  useBinarySerialization?: boolean;
  /** Enable latency monitoring */
  monitorLatency?: boolean;
}

/**
 * Latency measurement
 */
export interface LatencyMeasurement {
  channel: string;
  priority: MessagePriority;
  sendTime: number;
  ackTime?: number;
  latency?: number;
}

/**
 * IPC performance metrics
 */
export interface IPCMetrics {
  /** Total messages sent */
  messagesSent: number;
  /** Total messages received (acks) */
  messagesReceived: number;
  /** Messages sent per second (rolling average) */
  messagesPerSecond: number;
  /** Total bytes sent */
  bytesSent: number;
  /** Total bytes received */
  bytesReceived: number;
  /** Average latency by priority */
  avgLatencyByPriority: Record<MessagePriority, number>;
  /** P95 latency by priority */
  p95LatencyByPriority: Record<MessagePriority, number>;
  /** Batch statistics */
  batchStats: {
    batchesSent: number;
    avgBatchSize: number;
    batchSavings: number; // Messages saved by batching
  };
  /** Serialization stats */
  serializationStats: SerializationStats;
}

// ============================================================================
// Constants
// ============================================================================

/** Default batch interval for normal priority messages */
const DEFAULT_BATCH_INTERVAL = 16; // ~60fps

/** Default max batch size */
const DEFAULT_MAX_BATCH_SIZE = 50;

/** Latency measurement window size */
const LATENCY_WINDOW_SIZE = 100;

/** Metrics update interval */
const METRICS_UPDATE_INTERVAL = 1000;

// ============================================================================
// Message ID Generator
// ============================================================================

let messageIdCounter = 0;
function generateMessageId(): string {
  return `msg-${Date.now().toString(36)}-${(++messageIdCounter).toString(36)}`;
}

function generateBatchId(): string {
  return `batch-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;
}

// ============================================================================
// Optimized IPC Channel Manager
// ============================================================================

/**
 * Manages optimized IPC communication between main and renderer processes
 */
export class OptimizedIPCChannel extends EventEmitter {
  private mainWindow: BrowserWindow | null = null;
  private channels: Map<string, ChannelConfig> = new Map();
  private messageQueues: Map<MessagePriority, IPCMessage[]> = new Map();
  private batchTimers: Map<MessagePriority, NodeJS.Timeout> = new Map();
  private latencyMeasurements: Map<MessagePriority, number[]> = new Map();
  private pendingAcks: Map<string, { timestamp: number; priority: MessagePriority }> = new Map();

  // Metrics
  private metrics: IPCMetrics = this.initializeMetrics();
  private metricsInterval: NodeJS.Timeout | null = null;
  private lastMetricsTime = Date.now();
  private lastMessageCount = 0;

  constructor() {
    super();
    this.initializeQueues();
    this.setupAckHandlers();
  }

  private initializeMetrics(): IPCMetrics {
    return {
      messagesSent: 0,
      messagesReceived: 0,
      messagesPerSecond: 0,
      bytesSent: 0,
      bytesReceived: 0,
      avgLatencyByPriority: {
        [MessagePriority.CRITICAL]: 0,
        [MessagePriority.HIGH]: 0,
        [MessagePriority.NORMAL]: 0,
        [MessagePriority.LOW]: 0,
      },
      p95LatencyByPriority: {
        [MessagePriority.CRITICAL]: 0,
        [MessagePriority.HIGH]: 0,
        [MessagePriority.NORMAL]: 0,
        [MessagePriority.LOW]: 0,
      },
      batchStats: {
        batchesSent: 0,
        avgBatchSize: 0,
        batchSavings: 0,
      },
      serializationStats: getSerializationStats(),
    };
  }

  private initializeQueues(): void {
    for (const priority of [
      MessagePriority.CRITICAL,
      MessagePriority.HIGH,
      MessagePriority.NORMAL,
      MessagePriority.LOW,
    ]) {
      this.messageQueues.set(priority, []);
      this.latencyMeasurements.set(priority, []);
    }
  }

  private setupAckHandlers(): void {
    // Listen for acknowledgments from renderer
    ipcMain.on('ipc:ack', (_event, messageId: string) => {
      const pending = this.pendingAcks.get(messageId);
      if (pending) {
        const latency = Date.now() - pending.timestamp;
        this.recordLatency(pending.priority, latency);
        this.pendingAcks.delete(messageId);
        this.metrics.messagesReceived++;
      }
    });

    // Listen for batch acknowledgments
    ipcMain.on('ipc:batch-ack', (_event, batchId: string, count: number) => {
      logger.debug(`Batch ${batchId} acknowledged: ${count} messages`);
      this.metrics.messagesReceived += count;
    });
  }

  /**
   * Set the main window for IPC communication
   */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;

    if (window) {
      // Start metrics collection
      this.startMetricsCollection();
    } else {
      this.stopMetricsCollection();
    }
  }

  /**
   * Get the WebContents for sending messages
   */
  private getWebContents(): WebContents | null {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return null;
    }
    return this.mainWindow.webContents;
  }

  /**
   * Register a channel with specific configuration
   */
  registerChannel(config: ChannelConfig): void {
    this.channels.set(config.name, {
      ...config,
      batchInterval: config.batchInterval ?? DEFAULT_BATCH_INTERVAL,
      maxBatchSize: config.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE,
    });

    logger.debug(`Channel registered: ${config.name}`, {
      priority: MessagePriority[config.priority],
      batched: config.batched,
    });
  }

  /**
   * Register multiple channels at once
   */
  registerChannels(configs: ChannelConfig[]): void {
    for (const config of configs) {
      this.registerChannel(config);
    }
  }

  /**
   * Send a message to the renderer
   */
  async send<T>(channel: string, payload: T, options?: { requiresAck?: boolean }): Promise<void> {
    const config = this.channels.get(channel);
    const priority = config?.priority ?? MessagePriority.NORMAL;
    const batched = config?.batched ?? false;

    const message: IPCMessage<T> = {
      id: generateMessageId(),
      channel,
      priority,
      timestamp: Date.now(),
      payload,
      requiresAck: options?.requiresAck,
    };

    // Critical and high-priority messages are sent immediately
    if (priority <= MessagePriority.HIGH || !batched) {
      await this.sendImmediate(message);
    } else {
      this.queueMessage(message);
    }
  }

  /**
   * Send a message immediately (no batching)
   */
  private async sendImmediate<T>(message: IPCMessage<T>): Promise<void> {
    const webContents = this.getWebContents();
    if (!webContents) {
      logger.warn(`Cannot send message: no window available`, { channel: message.channel });
      return;
    }

    try {
      const config = this.channels.get(message.channel);
      let data: string | Buffer;

      // Determine serialization strategy
      if (config?.useBinarySerialization) {
        const result = await serialize(message);
        data = result.data;
        this.metrics.bytesSent += result.serializedSize;
      } else {
        data = JSON.stringify(message);
        this.metrics.bytesSent += Buffer.byteLength(data);
      }

      // Track for ack if required
      if (message.requiresAck) {
        this.pendingAcks.set(message.id, {
          timestamp: message.timestamp,
          priority: message.priority,
        });
      }

      // Send to renderer
      webContents.send('ipc:message', data);
      this.metrics.messagesSent++;

      this.emit('message-sent', {
        id: message.id,
        channel: message.channel,
        priority: message.priority,
      });
    } catch (error) {
      logger.error('Failed to send IPC message', {
        channel: message.channel,
        error: (error as Error).message,
      });
      this.emit('send-error', { message, error });
    }
  }

  /**
   * Queue a message for batching
   */
  private queueMessage<T>(message: IPCMessage<T>): void {
    const queue = this.messageQueues.get(message.priority);
    if (!queue) {
      logger.warn(`No queue for priority ${message.priority}`);
      return;
    }

    queue.push(message as IPCMessage);

    // Check if we need to flush due to size
    const config = this.channels.get(message.channel);
    const maxSize = config?.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;

    if (queue.length >= maxSize) {
      this.flushQueue(message.priority);
    } else if (!this.batchTimers.has(message.priority)) {
      // Schedule batch flush
      const interval = config?.batchInterval ?? DEFAULT_BATCH_INTERVAL;
      const timer = setTimeout(() => {
        this.flushQueue(message.priority);
      }, interval);
      this.batchTimers.set(message.priority, timer);
    }
  }

  /**
   * Flush a priority queue
   */
  private async flushQueue(priority: MessagePriority): Promise<void> {
    // Clear timer
    const timer = this.batchTimers.get(priority);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(priority);
    }

    const queue = this.messageQueues.get(priority);
    if (!queue || queue.length === 0) {
      return;
    }

    // Take all messages
    const messages = queue.splice(0);

    const webContents = this.getWebContents();
    if (!webContents) {
      logger.warn(`Cannot flush queue: no window available`, {
        priority: MessagePriority[priority],
        count: messages.length,
      });
      return;
    }

    try {
      const batch: BatchedMessages = {
        batchId: generateBatchId(),
        messages,
        createdAt: Date.now(),
        priority,
      };

      // Serialize batch
      const result = await serialize(batch);
      this.metrics.bytesSent += result.serializedSize;

      // Send batch
      webContents.send('ipc:batch', result.data);

      // Update metrics
      this.metrics.messagesSent += messages.length;
      this.metrics.batchStats.batchesSent++;
      this.metrics.batchStats.avgBatchSize =
        (this.metrics.batchStats.avgBatchSize *
          (this.metrics.batchStats.batchesSent - 1) +
          messages.length) /
        this.metrics.batchStats.batchesSent;
      this.metrics.batchStats.batchSavings += messages.length - 1;

      this.emit('batch-sent', {
        batchId: batch.batchId,
        count: messages.length,
        priority,
      });

      logger.debug(`Batch sent: ${messages.length} messages`, {
        batchId: batch.batchId,
        priority: MessagePriority[priority],
      });
    } catch (error) {
      logger.error('Failed to send batch', {
        priority: MessagePriority[priority],
        count: messages.length,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Send a high-frequency stream chunk (optimized for streaming updates)
   */
  sendStreamChunk(
    channel: string,
    type: string,
    data: string | number,
    id?: string
  ): void {
    const webContents = this.getWebContents();
    if (!webContents) {
      return;
    }

    const chunk = serializeStreamChunk({
      id: id || generateMessageId(),
      type,
      data,
    });

    webContents.send(channel, chunk);
    this.metrics.messagesSent++;
    this.metrics.bytesSent += chunk.length;
  }

  /**
   * Send audio data with optimized binary serialization
   */
  async sendAudioData(
    channel: string,
    audioBuffer: Buffer,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const webContents = this.getWebContents();
    if (!webContents) {
      return;
    }

    const message: IPCMessage = {
      id: generateMessageId(),
      channel,
      priority: MessagePriority.HIGH,
      timestamp: Date.now(),
      payload: {
        audio: audioBuffer.toString('base64'),
        ...metadata,
      },
    };

    const result = await serialize(message);
    webContents.send('ipc:audio', result.data);

    this.metrics.messagesSent++;
    this.metrics.bytesSent += result.serializedSize;
  }

  /**
   * Record latency measurement
   */
  private recordLatency(priority: MessagePriority, latency: number): void {
    const measurements = this.latencyMeasurements.get(priority);
    if (!measurements) return;

    measurements.push(latency);

    // Keep window size limited
    if (measurements.length > LATENCY_WINDOW_SIZE) {
      measurements.shift();
    }

    // Update metrics
    const sorted = [...measurements].sort((a, b) => a - b);
    const avg = measurements.reduce((a, b) => a + b, 0) / measurements.length;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;

    this.metrics.avgLatencyByPriority[priority] = avg;
    this.metrics.p95LatencyByPriority[priority] = p95;
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    if (this.metricsInterval) {
      return;
    }

    this.metricsInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - this.lastMetricsTime) / 1000;

      // Calculate messages per second
      const messagesSent = this.metrics.messagesSent - this.lastMessageCount;
      this.metrics.messagesPerSecond = messagesSent / elapsed;

      // Update serialization stats
      this.metrics.serializationStats = getSerializationStats();

      this.lastMetricsTime = now;
      this.lastMessageCount = this.metrics.messagesSent;

      this.emit('metrics-update', this.getMetrics());
    }, METRICS_UPDATE_INTERVAL);
  }

  /**
   * Stop metrics collection
   */
  private stopMetricsCollection(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): IPCMetrics {
    return {
      ...this.metrics,
      serializationStats: getSerializationStats(),
    };
  }

  /**
   * Get latency report
   */
  getLatencyReport(): Record<string, { avg: number; p95: number; samples: number }> {
    const report: Record<string, { avg: number; p95: number; samples: number }> = {};

    for (const [priority, measurements] of this.latencyMeasurements.entries()) {
      if (measurements.length > 0) {
        const sorted = [...measurements].sort((a, b) => a - b);
        report[MessagePriority[priority]] = {
          avg: measurements.reduce((a, b) => a + b, 0) / measurements.length,
          p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
          samples: measurements.length,
        };
      }
    }

    return report;
  }

  /**
   * Flush all pending messages
   */
  async flushAll(): Promise<void> {
    const flushPromises: Promise<void>[] = [];

    for (const priority of [
      MessagePriority.CRITICAL,
      MessagePriority.HIGH,
      MessagePriority.NORMAL,
      MessagePriority.LOW,
    ]) {
      flushPromises.push(this.flushQueue(priority));
    }

    await Promise.all(flushPromises);
  }

  /**
   * Clean up resources
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down optimized IPC channel');

    // Stop metrics collection
    this.stopMetricsCollection();

    // Clear all timers
    for (const timer of this.batchTimers.values()) {
      clearTimeout(timer);
    }
    this.batchTimers.clear();

    // Flush remaining messages
    await this.flushAll();

    // Clear queues
    this.messageQueues.clear();
    this.initializeQueues();

    // Log final metrics
    this.logMetrics();

    // Remove listeners
    ipcMain.removeAllListeners('ipc:ack');
    ipcMain.removeAllListeners('ipc:batch-ack');

    this.removeAllListeners();
  }

  /**
   * Log current metrics summary
   */
  logMetrics(): void {
    const metrics = this.getMetrics();

    logger.info('IPC Metrics Summary', {
      messagesSent: metrics.messagesSent,
      messagesReceived: metrics.messagesReceived,
      messagesPerSecond: metrics.messagesPerSecond.toFixed(1),
      bytesSent: `${(metrics.bytesSent / 1024).toFixed(1)}KB`,
      bytesReceived: `${(metrics.bytesReceived / 1024).toFixed(1)}KB`,
      batchesSent: metrics.batchStats.batchesSent,
      avgBatchSize: metrics.batchStats.avgBatchSize.toFixed(1),
      batchSavings: metrics.batchStats.batchSavings,
    });

    logger.info('IPC Latency Report', this.getLatencyReport());
  }
}

// ============================================================================
// Default Channel Configurations
// ============================================================================

/**
 * Pre-configured channels for Atlas IPC
 */
export const ATLAS_CHANNELS: ChannelConfig[] = [
  // Critical system events
  {
    name: 'atlas:error',
    priority: MessagePriority.CRITICAL,
    batched: false,
    monitorLatency: true,
  },
  {
    name: 'atlas:state-change',
    priority: MessagePriority.CRITICAL,
    batched: false,
    monitorLatency: true,
  },

  // High-priority voice events
  {
    name: 'atlas:wake-word',
    priority: MessagePriority.HIGH,
    batched: false,
    monitorLatency: true,
  },
  {
    name: 'atlas:transcript-interim',
    priority: MessagePriority.HIGH,
    batched: false,
    monitorLatency: false,
  },
  {
    name: 'atlas:transcript-final',
    priority: MessagePriority.HIGH,
    batched: false,
    monitorLatency: true,
  },
  {
    name: 'atlas:response-chunk',
    priority: MessagePriority.HIGH,
    batched: false,
    monitorLatency: false,
  },
  {
    name: 'atlas:response-complete',
    priority: MessagePriority.HIGH,
    batched: false,
    monitorLatency: true,
  },
  {
    name: 'atlas:audio-chunk',
    priority: MessagePriority.HIGH,
    batched: false,
    useBinarySerialization: true,
    monitorLatency: false,
  },

  // Normal priority status updates
  {
    name: 'atlas:audio-level',
    priority: MessagePriority.NORMAL,
    batched: true,
    batchInterval: 33, // ~30fps for audio level visualization
    maxBatchSize: 10,
    monitorLatency: false,
  },
  {
    name: 'atlas:provider-change',
    priority: MessagePriority.NORMAL,
    batched: false,
    monitorLatency: false,
  },
  {
    name: 'atlas:connectivity-change',
    priority: MessagePriority.NORMAL,
    batched: false,
    monitorLatency: false,
  },

  // Low priority analytics/background
  {
    name: 'atlas:metrics',
    priority: MessagePriority.LOW,
    batched: true,
    batchInterval: 1000,
    maxBatchSize: 100,
    monitorLatency: false,
  },
  {
    name: 'atlas:budget-update',
    priority: MessagePriority.LOW,
    batched: true,
    batchInterval: 500,
    maxBatchSize: 5,
    monitorLatency: false,
  },
];

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: OptimizedIPCChannel | null = null;

/**
 * Get the singleton OptimizedIPCChannel instance
 */
export function getOptimizedIPCChannel(): OptimizedIPCChannel {
  if (!instance) {
    instance = new OptimizedIPCChannel();
    instance.registerChannels(ATLAS_CHANNELS);
  }
  return instance;
}

/**
 * Create a new OptimizedIPCChannel instance (for testing)
 */
export function createOptimizedIPCChannel(): OptimizedIPCChannel {
  return new OptimizedIPCChannel();
}

/**
 * Shutdown the singleton instance
 */
export async function shutdownOptimizedIPCChannel(): Promise<void> {
  if (instance) {
    await instance.shutdown();
    instance = null;
  }
}
