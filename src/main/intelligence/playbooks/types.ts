/**
 * Playbook Types
 * Automated workflow definitions, triggers, and actions
 */

import { AgentId } from '../agents/types';
import { EntityType } from '../types';

// ============================================================================
// TRIGGER TYPES
// ============================================================================

export type TriggerType =
  | 'time'           // Scheduled (cron, interval)
  | 'event'          // System event
  | 'condition'      // When condition becomes true
  | 'entity_change'  // Entity created/updated/deleted
  | 'pattern'        // Pattern detected by dynamic layer
  | 'alert'          // Alert raised by an agent
  | 'voice'          // Voice command
  | 'manual';        // User-triggered

export interface BaseTrigger {
  id: string;
  type: TriggerType;
  enabled: boolean;
  description?: string;
}

export interface TimeTrigger extends BaseTrigger {
  type: 'time';
  schedule: {
    type: 'cron' | 'interval' | 'daily' | 'weekly' | 'monthly';
    value: string | number;  // cron expression or interval ms
    timezone?: string;
  };
}

export interface EventTrigger extends BaseTrigger {
  type: 'event';
  eventName: string;
  eventFilters?: Record<string, unknown>;
}

export interface ConditionTrigger extends BaseTrigger {
  type: 'condition';
  condition: {
    type: 'query' | 'expression';
    value: string;
  };
  checkIntervalMs: number;
}

export interface EntityChangeTrigger extends BaseTrigger {
  type: 'entity_change';
  entityType: EntityType;
  changeType: ('created' | 'updated' | 'deleted')[];
  propertyFilters?: Record<string, unknown>;
}

export interface PatternTrigger extends BaseTrigger {
  type: 'pattern';
  patternType: string;
  minConfidence: number;
}

export interface AlertTrigger extends BaseTrigger {
  type: 'alert';
  alertTypes: string[];
  agentIds?: AgentId[];
  minPriority?: number;
}

export interface VoiceTrigger extends BaseTrigger {
  type: 'voice';
  phrases: string[];
  requireExactMatch?: boolean;
}

export interface ManualTrigger extends BaseTrigger {
  type: 'manual';
  buttonLabel?: string;
}

export type Trigger =
  | TimeTrigger
  | EventTrigger
  | ConditionTrigger
  | EntityChangeTrigger
  | PatternTrigger
  | AlertTrigger
  | VoiceTrigger
  | ManualTrigger;

// ============================================================================
// ACTION TYPES
// ============================================================================

export type ActionType =
  | 'notify'          // Send notification
  | 'voice'           // Speak via TTS
  | 'create_entity'   // Create an entity
  | 'update_entity'   // Update an entity
  | 'delete_entity'   // Delete an entity
  | 'run_query'       // Run agent query
  | 'run_tool'        // Execute a tool
  | 'set_context'     // Set context in COP
  | 'send_message'    // Send email/message
  | 'open_app'        // Open application
  | 'webhook'         // Call external webhook
  | 'script'          // Run custom script
  | 'wait'            // Wait/delay
  | 'branch'          // Conditional branching
  | 'loop'            // Loop over items
  | 'parallel'        // Run actions in parallel
  | 'sub_playbook';   // Run another playbook

export interface BaseAction {
  id: string;
  type: ActionType;
  name: string;
  description?: string;
  continueOnError?: boolean;
  retryCount?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

export interface NotifyAction extends BaseAction {
  type: 'notify';
  config: {
    title: string;
    body: string;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    channels?: ('desktop' | 'mobile' | 'email')[];
  };
}

export interface VoiceAction extends BaseAction {
  type: 'voice';
  config: {
    text: string;
    interruptible?: boolean;
    waitForResponse?: boolean;
  };
}

export interface CreateEntityAction extends BaseAction {
  type: 'create_entity';
  config: {
    entityType: EntityType;
    data: Record<string, unknown>;
  };
}

export interface UpdateEntityAction extends BaseAction {
  type: 'update_entity';
  config: {
    entityId: string;
    updates: Record<string, unknown>;
  };
}

export interface DeleteEntityAction extends BaseAction {
  type: 'delete_entity';
  config: {
    entityId: string;
  };
}

export interface RunQueryAction extends BaseAction {
  type: 'run_query';
  config: {
    query: string;
    agentId?: AgentId;
    storeResultAs?: string;
  };
}

export interface RunToolAction extends BaseAction {
  type: 'run_tool';
  config: {
    toolName: string;
    params: Record<string, unknown>;
    storeResultAs?: string;
  };
}

export interface SetContextAction extends BaseAction {
  type: 'set_context';
  config: {
    contextType: string;
    contextName: string;
    metadata?: Record<string, unknown>;
    duration?: number;  // Auto-end after ms
  };
}

export interface SendMessageAction extends BaseAction {
  type: 'send_message';
  config: {
    channel: 'email' | 'slack' | 'discord' | 'sms';
    recipient: string;
    subject?: string;
    body: string;
  };
}

export interface OpenAppAction extends BaseAction {
  type: 'open_app';
  config: {
    appName: string;
    path?: string;
    args?: string[];
  };
}

export interface WebhookAction extends BaseAction {
  type: 'webhook';
  config: {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    body?: unknown;
    storeResultAs?: string;
  };
}

export interface ScriptAction extends BaseAction {
  type: 'script';
  config: {
    language: 'javascript' | 'python';
    code: string;
    storeResultAs?: string;
  };
}

export interface WaitAction extends BaseAction {
  type: 'wait';
  config: {
    durationMs: number;
  };
}

export interface BranchAction extends BaseAction {
  type: 'branch';
  config: {
    condition: string;
    thenActions: string[];  // Action IDs
    elseActions?: string[];
  };
}

export interface LoopAction extends BaseAction {
  type: 'loop';
  config: {
    items: string;  // Variable name or expression
    itemVariable: string;
    actions: string[];  // Action IDs
    maxIterations?: number;
  };
}

export interface ParallelAction extends BaseAction {
  type: 'parallel';
  config: {
    actions: string[];  // Action IDs
    waitForAll?: boolean;
  };
}

export interface SubPlaybookAction extends BaseAction {
  type: 'sub_playbook';
  config: {
    playbookId: string;
    inputMapping?: Record<string, string>;
    outputMapping?: Record<string, string>;
  };
}

export type Action =
  | NotifyAction
  | VoiceAction
  | CreateEntityAction
  | UpdateEntityAction
  | DeleteEntityAction
  | RunQueryAction
  | RunToolAction
  | SetContextAction
  | SendMessageAction
  | OpenAppAction
  | WebhookAction
  | ScriptAction
  | WaitAction
  | BranchAction
  | LoopAction
  | ParallelAction
  | SubPlaybookAction;

// ============================================================================
// PLAYBOOK
// ============================================================================

export type PlaybookStatus = 'draft' | 'active' | 'paused' | 'archived';
export type PlaybookCategory = 
  | 'productivity'
  | 'trading'
  | 'financial'
  | 'relationship'
  | 'health'
  | 'research'
  | 'system'
  | 'custom';

export interface Playbook {
  id: string;
  name: string;
  description: string;
  category: PlaybookCategory;
  status: PlaybookStatus;
  
  // Execution
  triggers: Trigger[];
  actions: Action[];
  actionOrder: string[];  // Action IDs in order
  
  // Variables
  variables?: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    default?: unknown;
    description?: string;
  }>;
  
  // Constraints
  runLimit?: {
    maxRuns: number;
    periodMs: number;
  };
  cooldownMs?: number;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  lastRunAt?: Date;
  runCount: number;
  successCount: number;
  errorCount: number;
  averageRunTimeMs: number;
  
  // Permissions
  requiresConfirmation?: boolean;
  allowedContexts?: string[];  // Only run in these contexts
  blockedContexts?: string[];  // Don't run in these contexts
}

// ============================================================================
// EXECUTION
// ============================================================================

export type ExecutionStatus = 
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'waiting';

export interface ActionResult {
  actionId: string;
  status: ExecutionStatus;
  startedAt: Date;
  completedAt?: Date;
  result?: unknown;
  error?: string;
  retryCount: number;
}

export interface PlaybookExecution {
  id: string;
  playbookId: string;
  playbookName: string;
  
  // Trigger info
  triggerId: string;
  triggerType: TriggerType;
  triggerData?: unknown;
  
  // Status
  status: ExecutionStatus;
  startedAt: Date;
  completedAt?: Date;
  
  // Results
  variables: Record<string, unknown>;
  actionResults: ActionResult[];
  currentActionIndex: number;
  
  // Errors
  error?: string;
  errorActionId?: string;
}

// ============================================================================
// TEMPLATES
// ============================================================================

export interface PlaybookTemplate {
  id: string;
  name: string;
  description: string;
  category: PlaybookCategory;
  playbook: Omit<Playbook, 'id' | 'createdAt' | 'updatedAt' | 'runCount' | 'successCount' | 'errorCount' | 'averageRunTimeMs'>;
  
  // Configuration prompts
  prompts?: {
    name: string;
    description: string;
    type: 'string' | 'number' | 'boolean' | 'select';
    options?: string[];
    default?: unknown;
    required?: boolean;
    variablePath: string;  // Where to insert the value
  }[];
}

// ============================================================================
// CONFIG
// ============================================================================

export interface PlaybookConfig {
  // Execution
  maxConcurrentExecutions: number;
  defaultTimeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  
  // Storage
  maxExecutionHistory: number;
  executionRetentionDays: number;
  
  // Safety
  requireConfirmationForDestructive: boolean;
  blockedActions: ActionType[];
  allowedWebhookDomains?: string[];
  
  // Scheduling
  schedulerIntervalMs: number;
  conditionCheckIntervalMs: number;
}

export const DEFAULT_PLAYBOOK_CONFIG: PlaybookConfig = {
  maxConcurrentExecutions: 5,
  defaultTimeoutMs: 30000,
  maxRetries: 3,
  retryDelayMs: 1000,
  
  maxExecutionHistory: 1000,
  executionRetentionDays: 30,
  
  requireConfirmationForDestructive: true,
  blockedActions: [],
  
  schedulerIntervalMs: 1000,
  conditionCheckIntervalMs: 5000,
};
