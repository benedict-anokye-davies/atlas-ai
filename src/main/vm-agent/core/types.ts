/**
 * Atlas Desktop - VM Computer Use Agent Core Types
 *
 * Enhanced type definitions for the world-class VM control system.
 * These types support event-driven architecture, state management,
 * VLM integration, and advanced learning capabilities.
 *
 * @module vm-agent/core/types
 */

// =============================================================================
// Event System Types
// =============================================================================

/**
 * All possible VM agent events
 */
export type VMAgentEventType =
  // Connection events
  | 'connection:connecting'
  | 'connection:connected'
  | 'connection:disconnected'
  | 'connection:error'
  | 'connection:reconnecting'
  // Screen events
  | 'screen:captured'
  | 'screen:changed'
  | 'screen:analyzed'
  | 'screen:stable'
  // Action events
  | 'action:planned'
  | 'action:executing'
  | 'action:completed'
  | 'action:failed'
  | 'action:retrying'
  // Task events
  | 'task:started'
  | 'task:step-started'
  | 'task:step-completed'
  | 'task:step-failed'
  | 'task:completed'
  | 'task:failed'
  | 'task:paused'
  | 'task:resumed'
  | 'task:cancelled'
  // Learning events
  | 'learning:demo-started'
  | 'learning:demo-ended'
  | 'learning:pattern-detected'
  | 'learning:behavior-learned'
  | 'learning:feedback-received'
  // State machine events
  | 'state:changed'
  | 'state:checkpoint-created'
  | 'state:rollback'
  // Vision events
  | 'vision:element-detected'
  | 'vision:element-lost'
  | 'vision:vlm-analysis'
  | 'vision:ocr-completed'
  // Error events
  | 'error:recoverable'
  | 'error:fatal'
  | 'error:recovery-started'
  | 'error:recovery-completed'
  // Prediction events
  | 'prediction:generated'
  | 'prediction:verified'
  | 'prediction:invalidated';

/**
 * Base event interface
 */
export interface VMAgentEvent<T = unknown> {
  /** Event type */
  type: VMAgentEventType;
  /** Event payload */
  payload: T;
  /** Timestamp when event was created */
  timestamp: number;
  /** Unique event ID */
  id: string;
  /** Optional correlation ID for tracking related events */
  correlationId?: string;
  /** Source component that emitted the event */
  source: string;
  /** Priority level */
  priority: 'low' | 'normal' | 'high' | 'critical';
}

/**
 * Event handler function
 */
export type VMAgentEventHandler<T = unknown> = (event: VMAgentEvent<T>) => void | Promise<void>;

/**
 * Event subscription
 */
export interface EventSubscription {
  /** Subscription ID */
  id: string;
  /** Event type(s) to listen for */
  eventTypes: VMAgentEventType | VMAgentEventType[] | '*';
  /** Handler function */
  handler: VMAgentEventHandler;
  /** Priority (higher = called first) */
  priority: number;
  /** Whether to auto-unsubscribe after first call */
  once: boolean;
  /** Filter function */
  filter?: (event: VMAgentEvent) => boolean;
}

// =============================================================================
// State Machine Types
// =============================================================================

/**
 * VM Agent states
 */
export type VMAgentState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'capturing'
  | 'analyzing'
  | 'planning'
  | 'executing'
  | 'waiting'
  | 'learning'
  | 'recovering'
  | 'paused'
  | 'error'
  | 'disconnected';

/**
 * State transition
 */
export interface StateTransition {
  /** Source state */
  from: VMAgentState;
  /** Target state */
  to: VMAgentState;
  /** Event that triggered the transition */
  event: string;
  /** Timestamp */
  timestamp: number;
  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * State machine context
 */
export interface StateMachineContext {
  /** Current state */
  currentState: VMAgentState;
  /** Previous state */
  previousState?: VMAgentState;
  /** State history */
  history: StateTransition[];
  /** Current task if any */
  currentTask?: TaskContext;
  /** Current action if any */
  currentAction?: ActionContext;
  /** Error context if in error state */
  errorContext?: ErrorContext;
  /** Recovery context if recovering */
  recoveryContext?: RecoveryContext;
  /** Checkpoint ID if available */
  lastCheckpointId?: string;
  /** State entry time */
  stateEnteredAt: number;
  /** Total time in current state */
  timeInState: number;
}

/**
 * Task context for state machine
 */
export interface TaskContext {
  /** Task ID */
  taskId: string;
  /** Task goal */
  goal: string;
  /** Current step index */
  currentStep: number;
  /** Total steps */
  totalSteps: number;
  /** Steps completed */
  stepsCompleted: number;
  /** Steps failed */
  stepsFailed: number;
  /** Started at */
  startedAt: number;
  /** Timeout at */
  timeoutAt?: number;
}

/**
 * Action context for state machine
 */
export interface ActionContext {
  /** Action ID */
  actionId: string;
  /** Action type */
  actionType: string;
  /** Action description */
  description: string;
  /** Retry count */
  retryCount: number;
  /** Max retries */
  maxRetries: number;
  /** Started at */
  startedAt: number;
}

/**
 * Error context
 */
export interface ErrorContext {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Error stack */
  stack?: string;
  /** Is recoverable */
  recoverable: boolean;
  /** Recovery attempts */
  recoveryAttempts: number;
  /** Original error */
  originalError?: Error;
  /** Context when error occurred */
  stateWhenOccurred: VMAgentState;
  /** Timestamp */
  timestamp: number;
}

/**
 * Recovery context
 */
export interface RecoveryContext {
  /** Recovery strategy being used */
  strategy: RecoveryStrategy;
  /** Steps taken */
  stepsTaken: number;
  /** Total steps in recovery */
  totalSteps: number;
  /** Started at */
  startedAt: number;
  /** Last checkpoint ID */
  checkpointId?: string;
  /** Recovery progress */
  progress: number;
}

/**
 * Recovery strategies
 */
export type RecoveryStrategy =
  | 'retry'
  | 'rollback'
  | 'alternative-path'
  | 'wait-and-retry'
  | 'human-intervention'
  | 'checkpoint-restore'
  | 'reconnect'
  | 'restart-task';

// =============================================================================
// Checkpoint Types
// =============================================================================

/**
 * Checkpoint for rollback support
 */
export interface Checkpoint {
  /** Unique checkpoint ID */
  id: string;
  /** Checkpoint name/description */
  name: string;
  /** State machine context at checkpoint */
  stateMachineContext: StateMachineContext;
  /** Screen state at checkpoint */
  screenState: SerializedScreenState;
  /** Task progress at checkpoint */
  taskProgress?: TaskProgress;
  /** Created at */
  createdAt: number;
  /** Checkpoint type */
  type: 'auto' | 'manual' | 'pre-action' | 'post-step' | 'error-recovery';
  /** Whether checkpoint is valid for rollback */
  valid: boolean;
  /** Expiry time */
  expiresAt?: number;
}

/**
 * Serialized screen state for checkpoints
 */
export interface SerializedScreenState {
  /** Screenshot as base64 */
  screenshot: string;
  /** Screen hash */
  hash: string;
  /** Detected elements summary */
  elementsSummary: {
    total: number;
    interactive: number;
    buttons: number;
    inputs: number;
  };
  /** Active window info */
  activeWindow?: {
    title: string;
    application: string;
  };
  /** Timestamp */
  timestamp: number;
}

/**
 * Task progress for checkpoints
 */
export interface TaskProgress {
  /** Task ID */
  taskId: string;
  /** Steps completed */
  stepsCompleted: number;
  /** Actions taken */
  actionsTaken: number;
  /** Current step index */
  currentStep: number;
  /** Intermediate results */
  intermediateResults?: Record<string, unknown>;
}

// =============================================================================
// VLM (Vision Language Model) Types
// =============================================================================

/**
 * VLM analysis request
 */
export interface VLMAnalysisRequest {
  /** Screenshot as base64 */
  screenshot: string;
  /** Analysis prompt */
  prompt: string;
  /** Request type */
  type: 'element-detection' | 'state-analysis' | 'action-planning' | 'error-diagnosis' | 'custom';
  /** Previous context for multi-turn */
  previousContext?: VLMContext[];
  /** Expected response format */
  responseFormat?: 'json' | 'text' | 'structured';
  /** Additional parameters */
  parameters?: Record<string, unknown>;
}

/**
 * VLM analysis result
 */
export interface VLMAnalysisResult {
  /** Request ID */
  requestId: string;
  /** Analysis type */
  type: VLMAnalysisRequest['type'];
  /** Raw response from VLM */
  rawResponse: string;
  /** Parsed structured response */
  structured?: VLMStructuredResponse;
  /** Confidence score */
  confidence: number;
  /** Processing time ms */
  processingTimeMs: number;
  /** Model used */
  model: string;
  /** Tokens used */
  tokensUsed: { input: number; output: number };
  /** Timestamp */
  timestamp: number;
}

/**
 * VLM context for multi-turn
 */
export interface VLMContext {
  /** Role */
  role: 'user' | 'assistant';
  /** Content */
  content: string;
  /** Screenshot if any */
  screenshot?: string;
  /** Timestamp */
  timestamp: number;
}

/**
 * Structured response from VLM
 */
export interface VLMStructuredResponse {
  /** Detected elements */
  elements?: VLMDetectedElement[];
  /** State analysis */
  stateAnalysis?: {
    currentApplication: string;
    currentScreen: string;
    possibleActions: string[];
    potentialIssues: string[];
    confidence: number;
  };
  /** Action recommendations */
  actionRecommendations?: Array<{
    action: string;
    target: string;
    confidence: number;
    reasoning: string;
  }>;
  /** Error diagnosis */
  errorDiagnosis?: {
    errorType: string;
    errorMessage: string;
    possibleCauses: string[];
    suggestedFixes: string[];
  };
  /** Custom response */
  custom?: Record<string, unknown>;
}

/**
 * VLM detected element
 */
export interface VLMDetectedElement {
  /** Element type */
  type: 'button' | 'input' | 'link' | 'text' | 'icon' | 'menu' | 'dialog' | 'image' | 'other';
  /** Description */
  description: string;
  /** Bounding box (normalized 0-1) */
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Text content if any */
  text?: string;
  /** Is interactive */
  interactive: boolean;
  /** Confidence */
  confidence: number;
  /** Semantic purpose */
  semanticPurpose?: string;
}

// =============================================================================
// Enhanced Element Types
// =============================================================================

/**
 * Enhanced UI element with self-healing support
 */
export interface EnhancedUIElement {
  /** Base element ID */
  id: string;
  /** Element type */
  type: string;
  /** Bounding box */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Center point */
  center: { x: number; y: number };
  /** Text content */
  text?: string;
  /** Overall confidence */
  confidence: number;
  /** Is interactive */
  isInteractive: boolean;
  /** Detection source */
  detectionSource: 'vlm' | 'ocr' | 'edge-detection' | 'template' | 'learned';
  /** Selector strategies for self-healing */
  selectors: ElementSelector[];
  /** Element signature for matching */
  signature: ElementSignature;
  /** Last verified timestamp */
  lastVerified: number;
  /** Verification count */
  verificationCount: number;
}

/**
 * Element selector for self-healing
 */
export interface ElementSelector {
  /** Selector type */
  type: 'visual' | 'text' | 'position' | 'semantic' | 'template';
  /** Selector value/description */
  value: string;
  /** Priority (higher = preferred) */
  priority: number;
  /** Success rate */
  successRate: number;
  /** Times used */
  uses: number;
}

/**
 * Element signature for fuzzy matching
 */
export interface ElementSignature {
  /** Approximate size category */
  size: 'tiny' | 'small' | 'medium' | 'large' | 'huge';
  /** Visual appearance hash */
  visualHash?: string;
  /** Text content normalized */
  normalizedText?: string;
  /** Relative position */
  relativePosition: {
    horizontal: 'left' | 'center' | 'right';
    vertical: 'top' | 'middle' | 'bottom';
  };
  /** Neighbor elements */
  neighbors?: {
    above?: string;
    below?: string;
    left?: string;
    right?: string;
  };
}

// =============================================================================
// Cross-Application Workflow Types
// =============================================================================

/**
 * Multi-application workflow
 */
export interface CrossAppWorkflow {
  /** Workflow ID */
  id: string;
  /** Workflow name */
  name: string;
  /** Description */
  description: string;
  /** Workflow steps */
  steps: WorkflowStep[];
  /** Required applications */
  requiredApplications: string[];
  /** Estimated duration */
  estimatedDurationMs: number;
  /** Success rate */
  successRate: number;
  /** Created at */
  createdAt: number;
  /** Last executed */
  lastExecuted?: number;
  /** Times executed */
  executionCount: number;
}

/**
 * Workflow step
 */
export interface WorkflowStep {
  /** Step index */
  index: number;
  /** Application for this step */
  application: string;
  /** Step description */
  description: string;
  /** Action to perform */
  action: string;
  /** Parameters */
  parameters?: Record<string, unknown>;
  /** Expected result */
  expectedResult: string;
  /** Dependencies */
  dependsOn: number[];
  /** Timeout ms */
  timeoutMs: number;
  /** Recovery strategy if fails */
  recoveryStrategy?: RecoveryStrategy;
  /** Data to pass to next step */
  outputData?: string[];
}

// =============================================================================
// Multi-VM Orchestration Types
// =============================================================================

/**
 * Multi-VM task
 */
export interface MultiVMTask {
  /** Task ID */
  id: string;
  /** Task description */
  description: string;
  /** VMs involved */
  vms: VMTaskAssignment[];
  /** Coordination strategy */
  coordinationStrategy: 'sequential' | 'parallel' | 'leader-follower';
  /** Data sharing between VMs */
  dataSharing: DataSharingConfig[];
  /** Overall timeout */
  timeoutMs: number;
}

/**
 * VM task assignment
 */
export interface VMTaskAssignment {
  /** VM identifier */
  vmId: string;
  /** Task portion */
  task: string;
  /** Order (for sequential) */
  order: number;
  /** Dependencies */
  dependsOn?: string[];
}

/**
 * Data sharing configuration
 */
export interface DataSharingConfig {
  /** Source VM */
  sourceVm: string;
  /** Target VM */
  targetVm: string;
  /** Data type */
  dataType: 'text' | 'file' | 'screenshot' | 'state';
  /** Transfer method */
  method: 'clipboard' | 'shared-folder' | 'api' | 'ocr';
}

// =============================================================================
// Metrics and Telemetry Types
// =============================================================================

/**
 * Agent metrics
 */
export interface AgentMetrics {
  /** Session ID */
  sessionId: string;
  /** Started at */
  startedAt: number;
  /** Uptime ms */
  uptimeMs: number;
  /** Tasks completed */
  tasksCompleted: number;
  /** Tasks failed */
  tasksFailed: number;
  /** Actions executed */
  actionsExecuted: number;
  /** Actions failed */
  actionsFailed: number;
  /** Average action latency */
  avgActionLatencyMs: number;
  /** Screenshots captured */
  screenshotsCaptured: number;
  /** VLM calls made */
  vlmCallsMade: number;
  /** Checkpoints created */
  checkpointsCreated: number;
  /** Recoveries performed */
  recoveriesPerformed: number;
  /** Learning events */
  learningEvents: number;
  /** Error counts by type */
  errorsByType: Record<string, number>;
}

/**
 * Performance sample
 */
export interface PerformanceSample {
  /** Sample timestamp */
  timestamp: number;
  /** Action latency ms */
  actionLatencyMs: number;
  /** Screen capture ms */
  screenCaptureMs: number;
  /** VLM analysis ms */
  vlmAnalysisMs?: number;
  /** Memory usage MB */
  memoryUsageMb: number;
  /** CPU usage percent */
  cpuUsagePercent: number;
}

// =============================================================================
// Agent Configuration Types
// =============================================================================

/**
 * Enhanced VM Agent configuration
 */
export interface EnhancedVMAgentConfig {
  /** Event system config */
  events: {
    /** Max events in history */
    maxHistorySize: number;
    /** Event TTL ms */
    eventTtlMs: number;
    /** Enable event logging */
    enableLogging: boolean;
  };
  /** State machine config */
  stateMachine: {
    /** Max state history */
    maxHistorySize: number;
    /** State timeout configs */
    stateTimeouts: Partial<Record<VMAgentState, number>>;
  };
  /** Checkpoint config */
  checkpoints: {
    /** Enable auto checkpoints */
    enableAutoCheckpoints: boolean;
    /** Auto checkpoint interval ms */
    autoCheckpointIntervalMs: number;
    /** Max checkpoints to keep */
    maxCheckpoints: number;
    /** Checkpoint expiry ms */
    checkpointExpiryMs: number;
  };
  /** VLM config */
  vlm: {
    /** Enable VLM */
    enabled: boolean;
    /** Model to use */
    model: 'gpt-4o' | 'gpt-4-vision' | 'qwen-vl' | 'llava';
    /** Temperature */
    temperature: number;
    /** Max tokens */
    maxTokens: number;
    /** Request timeout */
    timeoutMs: number;
    /** Cache responses */
    cacheResponses: boolean;
  };
  /** Self-healing config */
  selfHealing: {
    /** Enable self-healing selectors */
    enabled: boolean;
    /** Max repair attempts */
    maxRepairAttempts: number;
    /** Selector cache TTL */
    cacheTtlMs: number;
  };
  /** Recovery config */
  recovery: {
    /** Max retries per action */
    maxRetries: number;
    /** Retry delay ms */
    retryDelayMs: number;
    /** Enable checkpoint recovery */
    enableCheckpointRecovery: boolean;
    /** Recovery strategies by error type */
    strategiesByErrorType: Record<string, RecoveryStrategy>;
  };
  /** Prediction config */
  prediction: {
    /** Enable predictive engine */
    enabled: boolean;
    /** Prediction lookahead */
    lookahead: number;
    /** Min confidence threshold */
    minConfidence: number;
    /** Enable speculative execution */
    enableSpeculation: boolean;
  };
  /** Learning config */
  learning: {
    /** Enable few-shot learning */
    enableFewShot: boolean;
    /** Enable active learning */
    enableActiveLearning: boolean;
    /** Feedback collection mode */
    feedbackMode: 'always' | 'on-failure' | 'never';
    /** Min demos for pattern */
    minDemosForPattern: number;
  };
  /** Performance config */
  performance: {
    /** Target FPS for screen capture */
    targetFps: number;
    /** Enable GPU acceleration */
    enableGpu: boolean;
    /** Max concurrent VLM calls */
    maxConcurrentVlmCalls: number;
    /** Enable metrics collection */
    enableMetrics: boolean;
  };
}

/**
 * Default enhanced configuration
 */
export const DEFAULT_ENHANCED_CONFIG: EnhancedVMAgentConfig = {
  events: {
    maxHistorySize: 1000,
    eventTtlMs: 3600000, // 1 hour
    enableLogging: true,
  },
  stateMachine: {
    maxHistorySize: 100,
    stateTimeouts: {
      executing: 60000,
      waiting: 30000,
      recovering: 120000,
    },
  },
  checkpoints: {
    enableAutoCheckpoints: true,
    autoCheckpointIntervalMs: 30000,
    maxCheckpoints: 20,
    checkpointExpiryMs: 3600000,
  },
  vlm: {
    enabled: true,
    model: 'gpt-4o',
    temperature: 0.3,
    maxTokens: 2048,
    timeoutMs: 30000,
    cacheResponses: true,
  },
  selfHealing: {
    enabled: true,
    maxRepairAttempts: 3,
    cacheTtlMs: 600000, // 10 minutes
  },
  recovery: {
    maxRetries: 3,
    retryDelayMs: 1000,
    enableCheckpointRecovery: true,
    strategiesByErrorType: {
      'element-not-found': 'alternative-path',
      'timeout': 'wait-and-retry',
      'connection-lost': 'reconnect',
      'unexpected-state': 'rollback',
    },
  },
  prediction: {
    enabled: true,
    lookahead: 3,
    minConfidence: 0.7,
    enableSpeculation: true,
  },
  learning: {
    enableFewShot: true,
    enableActiveLearning: true,
    feedbackMode: 'on-failure',
    minDemosForPattern: 3,
  },
  performance: {
    targetFps: 2,
    enableGpu: true,
    maxConcurrentVlmCalls: 2,
    enableMetrics: true,
  },
};
