/**
 * @fileoverview Agent Swarm Types - Type definitions for multi-agent system
 * @module agent/swarm/types
 * @author Atlas Team
 * @since 2.0.0
 *
 * @description
 * Core type definitions for the agent swarm system including tasks,
 * execution modes, communication protocols, and result types.
 */

// =============================================================================
// Task Types
// =============================================================================

/**
 * Task complexity level
 */
export type TaskComplexity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Task execution mode
 */
export type ExecutionMode = 'parallel' | 'sequential' | 'hybrid';

/**
 * Task definition
 */
export interface Task {
  /** Unique task ID */
  id: string;
  /** Task description */
  description: string;
  /** Task type for agent matching */
  type?: string;
  /** Task complexity */
  complexity: TaskComplexity;
  /** Required agent capabilities */
  requiredCapabilities?: string[];
  /** Task dependencies (IDs of tasks that must complete first) */
  dependencies?: string[];
  /** Whether this task is critical (failure stops execution) */
  critical?: boolean;
  /** Task timeout in ms */
  timeout?: number;
  /** Task context/data */
  context?: Record<string, unknown>;
  /** Parent task ID (if this is a subtask) */
  parentId?: string;
  /** Task priority (higher = more important) */
  priority?: number;
}

/**
 * Task result
 */
export interface TaskResult {
  /** Success status */
  success: boolean;
  /** Task ID */
  taskId: string;
  /** Human-readable output */
  output?: string | null;
  /** Structured result data */
  data?: unknown | null;
  /** Error message if failed */
  error?: string;
  /** Execution metadata */
  metadata?: {
    startTime?: number;
    endTime?: number;
    duration?: number;
    agentId?: string;
    agentType?: string;
  };
}

/**
 * Task decomposition result
 */
export interface TaskDecomposition {
  /** Original task */
  originalTask: Task;
  /** Decomposed subtasks */
  subtasks: Task[];
  /** Execution strategy */
  strategy: ExecutionStrategy;
  /** Estimated total duration */
  estimatedDuration: number;
  /** Required agent types */
  requiredAgentTypes: string[];
}

/**
 * Execution strategy for task decomposition
 */
export interface ExecutionStrategy {
  /** Execution mode */
  mode: ExecutionMode;
  /** Grouping of tasks (for hybrid mode) */
  groups?: Task[][];
  /** Parallelization factor */
  parallelFactor: number;
  /** Retry strategy */
  retryStrategy: RetryStrategy;
}

/**
 * Retry strategy for failed tasks
 */
export interface RetryStrategy {
  /** Maximum retry attempts */
  maxRetries: number;
  /** Retry delay in ms */
  retryDelay: number;
  /** Whether to use exponential backoff */
  exponentialBackoff: boolean;
  /** Task types that should not be retried */
  nonRetryableTypes?: string[];
}

// =============================================================================
// Communication Types
// =============================================================================

/**
 * Message types for inter-agent communication
 */
export type MessageType =
  | 'request'
  | 'response'
  | 'broadcast'
  | 'query'
  | 'update'
  | 'notification';

/**
 * Inter-agent message
 */
export interface AgentMessage {
  /** Message ID */
  id: string;
  /** Message type */
  type: MessageType;
  /** Sender agent ID */
  from: string;
  /** Recipient agent ID (null for broadcast) */
  to: string | null;
  /** Message payload */
  payload: unknown;
  /** Timestamp */
  timestamp: number;
  /** Conversation/thread ID */
  threadId?: string;
  /** Reply to message ID */
  replyTo?: string;
  /** Message priority */
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}

/**
 * Communication channel
 */
export interface CommunicationChannel {
  /** Channel ID */
  id: string;
  /** Channel name/topic */
  name: string;
  /** Subscribed agent IDs */
  subscribers: string[];
  /** Message history */
  messages: AgentMessage[];
  /** Channel creation timestamp */
  createdAt: number;
}

// =============================================================================
// Agent Configuration Types
// =============================================================================

/**
 * Agent status
 */
export type AgentStatus = 'idle' | 'busy' | 'error' | 'offline' | 'initializing';

/**
 * Agent type/category
 */
export type AgentType =
  | 'coder'
  | 'research'
  | 'creative'
  | 'system'
  | 'data'
  | 'security'
  | 'general';

/**
 * Agent configuration
 */
export interface AgentConfig {
  /** Agent type */
  type: AgentType;
  /** Agent name */
  name: string;
  /** Agent description */
  description?: string;
  /** Agent capabilities */
  capabilities: string[];
  /** Maximum concurrent tasks */
  maxConcurrentTasks: number;
  /** Task priority (higher = preferred for matching) */
  priority: number;
  /** Agent-specific settings */
  settings?: Record<string, unknown>;
  /** LLM configuration */
  llmConfig?: {
    model: string;
    temperature?: number;
    maxTokens?: number;
  };
}

// =============================================================================
// Result Aggregation Types
// =============================================================================

/**
 * Aggregation strategy
 */
export type AggregationStrategy =
  | 'concatenate'
  | 'merge'
  | 'vote'
  | 'average'
  | 'best'
  | 'hierarchical';

/**
 * Aggregation result
 */
export interface AggregationResult {
  /** Overall success */
  success: boolean;
  /** Aggregated output */
  output: string;
  /** Aggregated data */
  data: unknown;
  /** Errors encountered */
  errors: Error[];
  /** Consensus score (0-1) if applicable */
  consensusScore?: number;
  /** Individual results that were aggregated */
  sourceResults?: TaskResult[];
}

// =============================================================================
// Swarm Event Types
// =============================================================================

/**
 * Swarm event types
 */
export type SwarmEventType =
  | 'agent-registered'
  | 'agent-unregistered'
  | 'agent-status-change'
  | 'task-started'
  | 'task-complete'
  | 'task-failed'
  | 'communication-received'
  | 'consensus-reached'
  | 'error';

/**
 * Swarm event
 */
export interface SwarmEvent {
  /** Event type */
  type: SwarmEventType;
  /** Event timestamp */
  timestamp: number;
  /** Event data */
  data: unknown;
  /** Source agent/task ID */
  source?: string;
}
