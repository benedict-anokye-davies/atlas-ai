/**
 * Atlas Desktop - Workflow Types
 * Types for visual workflow automation system
 */

/**
 * Node types in a workflow
 */
export type WorkflowNodeType = 'trigger' | 'action' | 'condition' | 'output';

/**
 * Trigger types
 */
export type TriggerType =
  | 'voice_command'
  | 'schedule'
  | 'webhook'
  | 'file_change'
  | 'email'
  | 'price_alert'
  | 'app_event';

/**
 * Action types
 */
export type ActionType =
  | 'run_terminal'
  | 'open_app'
  | 'send_email'
  | 'http_request'
  | 'write_file'
  | 'screenshot'
  | 'notify'
  | 'ai_chat'
  | 'clipboard'
  | 'spotify';

/**
 * Condition types
 */
export type ConditionType = 'if_else' | 'contains' | 'compare' | 'file_exists' | 'regex_match';

/**
 * Workflow node data
 */
export interface WorkflowNodeData {
  label: string;
  type: WorkflowNodeType;
  icon: string;
  description?: string;
  config?: Record<string, unknown>;
}

/**
 * Workflow node (ReactFlow compatible)
 */
export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  position: { x: number; y: number };
  data: WorkflowNodeData;
}

/**
 * Workflow edge (ReactFlow compatible)
 */
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: string;
  animated?: boolean;
  style?: Record<string, unknown>;
}

/**
 * Workflow definition
 */
export interface Workflow {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  runCount: number;
  tags?: string[];
}

/**
 * Workflow execution status
 */
export type WorkflowExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Workflow execution result
 */
export interface WorkflowExecutionResult {
  workflowId: string;
  executionId: string;
  status: WorkflowExecutionStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
  nodeResults: Record<string, NodeExecutionResult>;
}

/**
 * Node execution result
 */
export interface NodeExecutionResult {
  nodeId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  output?: unknown;
  error?: string;
}

/**
 * Workflow trigger event
 */
export interface WorkflowTriggerEvent {
  type: TriggerType;
  workflowId: string;
  payload?: Record<string, unknown>;
  timestamp: string;
}

/**
 * Schedule configuration for scheduled triggers
 */
export interface ScheduleConfig {
  type: 'once' | 'interval' | 'cron';
  /** For 'once': ISO timestamp */
  at?: string;
  /** For 'interval': milliseconds */
  intervalMs?: number;
  /** For 'cron': cron expression */
  cron?: string;
  /** Timezone for cron */
  timezone?: string;
}

/**
 * Webhook configuration
 */
export interface WebhookConfig {
  /** Generated webhook URL path */
  path: string;
  /** HTTP methods to accept */
  methods: ('GET' | 'POST' | 'PUT' | 'DELETE')[];
  /** Optional secret for validation */
  secret?: string;
}

/**
 * IPC result for workflow operations
 */
export interface WorkflowIPCResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
