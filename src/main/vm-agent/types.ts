/**
 * Atlas Desktop - VM Agent Types
 *
 * Type definitions for the autonomous VM control agent with learning capabilities.
 * Enables Atlas to use a virtual machine like a human uses a computer.
 *
 * @module vm-agent/types
 */

// =============================================================================
// VM Connection Types
// =============================================================================

/**
 * Supported VM connection protocols
 */
export type VMConnectionType = 'vnc' | 'rdp' | 'hyperv' | 'virtualbox' | 'vmware';

/**
 * VM connection configuration
 */
export interface VMConnectionConfig {
  /** Connection type */
  type: VMConnectionType;
  /** VM hostname or IP */
  host: string;
  /** Connection port */
  port: number;
  /** Username for authentication */
  username?: string;
  /** Password for authentication */
  password?: string;
  /** VM name (for Hyper-V/VirtualBox) */
  vmName?: string;
  /** Screen resolution to use */
  resolution?: { width: number; height: number };
  /** Color depth */
  colorDepth?: 16 | 24 | 32;
  /** Reconnect automatically on disconnect */
  autoReconnect?: boolean;
  /** Connection timeout in ms */
  timeout?: number;
}

/**
 * VM connection state
 */
export type VMConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * VM connection status
 */
export interface VMConnectionStatus {
  state: VMConnectionState;
  /** Whether connected */
  connected: boolean;
  /** Connection type */
  type?: VMConnectionType;
  /** VM name if applicable */
  vmName?: string;
  connectedAt?: number;
  lastActivity?: number;
  resolution?: { width: number; height: number };
  latencyMs?: number;
  error?: string;
}

// =============================================================================
// Screen Understanding Types
// =============================================================================

/**
 * Detected UI element on screen
 */
export interface UIElement {
  /** Unique ID for this detection */
  id: string;
  /** Element type */
  type: 'button' | 'textbox' | 'checkbox' | 'dropdown' | 'link' | 'icon' | 'menu' | 'window' | 'text' | 'image' | 'unknown';
  /** Bounding box */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Center point for clicking */
  center: { x: number; y: number };
  /** Detected text content */
  text?: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Whether element appears interactive */
  isInteractive: boolean;
  /** Whether element appears focused */
  isFocused?: boolean;
  /** Accessibility label if detected */
  ariaLabel?: string;
  /** Visual description */
  description?: string;
}

/**
 * Screen state understanding
 */
export interface ScreenState {
  /** Timestamp of capture */
  timestamp: number;
  /** Screenshot as base64 PNG */
  screenshot: string;
  /** Screen resolution */
  resolution: { width: number; height: number };
  /** Detected UI elements */
  elements: UIElement[];
  /** Detected text regions (OCR) */
  textRegions: Array<{
    text: string;
    bounds: { x: number; y: number; width: number; height: number };
    confidence: number;
  }>;
  /** Current window/application detected */
  activeWindow?: {
    title: string;
    application: string;
  };
  /** Mouse cursor position */
  cursorPosition?: { x: number; y: number };
  /** Screen hash for change detection */
  stateHash: string;
}

/**
 * Screen change event
 */
export interface ScreenChange {
  /** Previous state hash */
  previousHash: string;
  /** New state hash */
  newHash: string;
  /** Changed regions */
  changedRegions: Array<{ x: number; y: number; width: number; height: number }>;
  /** Percentage of screen that changed */
  changePercentage: number;
  /** Time since last state */
  timeSinceLastMs: number;
}

// =============================================================================
// Action Types
// =============================================================================

/**
 * Input action to perform on VM
 */
export type VMAction =
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right' | 'middle' }
  | { type: 'doubleClick'; x: number; y: number }
  | { type: 'rightClick'; x: number; y: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'drag'; fromX: number; fromY: number; toX: number; toY: number }
  | { type: 'scroll'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'type'; text: string }
  | { type: 'keyPress'; key: string; modifiers?: string[] }
  | { type: 'keyDown'; key: string }
  | { type: 'keyUp'; key: string }
  | { type: 'hotkey'; keys: string[] }
  | { type: 'wait'; ms: number }
  | { type: 'waitForChange'; timeoutMs?: number; region?: { x: number; y: number; width: number; height: number } }
  | { type: 'screenshot' };

/**
 * Action execution result
 */
export interface ActionResult {
  success: boolean;
  action: VMAction;
  executedAt: number;
  durationMs: number;
  error?: string;
  /** Screenshot after action (if requested) */
  screenshotAfter?: string;
  /** Screen state after action */
  stateAfter?: ScreenState;
}

/**
 * Action with metadata for learning
 */
export interface RecordedAction {
  /** Unique action ID */
  id: string;
  /** The action performed */
  action: VMAction;
  /** Screen state before action */
  stateBefore: ScreenState;
  /** Screen state after action */
  stateAfter: ScreenState;
  /** Natural language intent */
  intent?: string;
  /** Whether action achieved its goal */
  success?: boolean;
  /** Human feedback/annotation */
  feedback?: string;
  /** Timestamp */
  timestamp: number;
  /** Duration in ms */
  durationMs: number;
}

// =============================================================================
// Demonstration & Learning Types
// =============================================================================

/**
 * A recorded demonstration (sequence of actions)
 */
export interface Demonstration {
  /** Unique ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Natural language description of what was done */
  description: string;
  /** Task category (e.g., 'worldbox', 'web-browsing', 'file-management') */
  category: string;
  /** Sequence of recorded actions */
  actions: RecordedAction[];
  /** Initial screen state */
  initialState: ScreenState;
  /** Final screen state */
  finalState: ScreenState;
  /** Whether the demo successfully completed the task */
  successful: boolean;
  /** Total duration in ms */
  totalDurationMs: number;
  /** Created timestamp */
  createdAt: number;
  /** Tags for organization */
  tags: string[];
}

/**
 * Learned behavior pattern
 */
export interface LearnedBehavior {
  /** Unique ID */
  id: string;
  /** What triggers this behavior */
  trigger: {
    /** Natural language description */
    description: string;
    /** Visual patterns to match */
    visualPatterns?: string[];
    /** Text patterns to match */
    textPatterns?: string[];
    /** Application context */
    applicationContext?: string;
  };
  /** Sequence of actions to perform */
  actionSequence: VMAction[];
  /** Expected outcome */
  expectedOutcome: string;
  /** Success rate from past executions */
  successRate: number;
  /** Number of times executed */
  executionCount: number;
  /** Source demonstrations */
  sourceDemoIds: string[];
  /** Confidence in this behavior */
  confidence: number;
  /** Last updated timestamp */
  updatedAt: number;
}

/**
 * Reinforcement learning feedback
 */
export interface ReinforcementFeedback {
  /** Action ID being rated */
  actionId: string;
  /** Reward signal (-1 to 1) */
  reward: number;
  /** Human feedback text */
  feedback?: string;
  /** Whether to remember this as positive/negative example */
  remember: boolean;
}

/**
 * Learning statistics
 */
export interface LearningStats {
  /** Total demonstrations recorded */
  totalDemonstrations: number;
  /** Total actions recorded */
  totalActions: number;
  /** Learned behaviors count */
  learnedBehaviors: number;
  /** Average success rate */
  averageSuccessRate: number;
  /** Actions by category */
  actionsByCategory: Record<string, number>;
  /** Most common patterns */
  commonPatterns: Array<{ pattern: string; count: number }>;
}

// =============================================================================
// Task Planning Types
// =============================================================================

/**
 * A task for the VM agent to accomplish
 */
export interface VMTask {
  /** Unique task ID */
  id: string;
  /** Natural language goal */
  goal: string;
  /** Short description */
  description?: string;
  /** Detailed instructions */
  instructions?: string;
  /** Task category */
  category: string;
  /** Context (e.g., application name) */
  context?: string;
  /** Priority level */
  priority: 'low' | 'medium' | 'high';
  /** Maximum time to spend (ms) */
  timeoutMs?: number;
  /** Maximum actions to take */
  maxActions?: number;
  /** Whether to ask for confirmation before critical actions */
  requireConfirmation?: boolean;
  /** Success criteria (natural language) */
  successCriteria?: string;
  /** Created timestamp */
  createdAt: number;
}

/**
 * Planned step to achieve a task
 */
export interface PlannedStep {
  /** Step number */
  stepNumber: number;
  /** What to do */
  description: string;
  /** Expected action type */
  expectedActionType: VMAction['type'];
  /** The action to execute */
  action: VMAction;
  /** Target element description */
  targetElement?: string;
  /** Success criteria for this step */
  successCriteria: string;
  /** Estimated confidence we can do this */
  confidence: number;
  /** Dependencies on previous steps */
  dependsOn: number[];
  /** Step execution status */
  status?: StepStatus;
  /** When step started */
  startedAt?: number;
  /** When step completed */
  completedAt?: number;
  /** Error if failed */
  error?: string;
  /** Retry count */
  retryCount?: number;
  /** Actual screen state after execution */
  actualState?: ScreenState;
}

/**
 * Step execution status
 */
export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

/**
 * Task execution plan
 */
export interface TaskPlan {
  /** Plan ID */
  id: string;
  /** Task being planned */
  task: VMTask;
  /** Planned steps */
  steps: PlannedStep[];
  /** Overall confidence */
  overallConfidence: number;
  /** Estimated duration */
  estimatedDurationMs: number;
  /** Potential failure points */
  risks: Array<{ step: number; risk: string; mitigation: string }>;
  /** Created timestamp */
  createdAt: number;
  /** Plan status */
  status: 'planning' | 'ready' | 'executing' | 'completed' | 'failed' | 'cancelled';
  /** Current step index during execution */
  currentStepIndex: number;
  /** When execution started */
  startedAt?: number;
  /** When execution completed */
  completedAt?: number;
}

/**
 * Task execution state
 */
export type TaskExecutionState = 
  | 'pending'
  | 'planning'
  | 'executing'
  | 'waiting_confirmation'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Task execution result
 */
export interface TaskExecutionResult {
  /** Task that was executed */
  task: VMTask;
  /** Final state */
  state: TaskExecutionState;
  /** Whether task was successful */
  success: boolean;
  /** Steps executed */
  stepsExecuted: number;
  /** Total steps planned */
  totalSteps: number;
  /** Actions taken */
  actionsTaken: RecordedAction[];
  /** Total duration */
  durationMs: number;
  /** Error if failed */
  error?: string;
  /** Natural language summary */
  summary: string;
  /** Final screenshot */
  finalScreenshot?: string;
}

// =============================================================================
// Memory Types
// =============================================================================

/**
 * Stored memory about a successful strategy
 */
export interface StrategyMemory {
  /** Unique ID */
  id: string;
  /** What situation this applies to */
  situation: string;
  /** Application/game context */
  context: string;
  /** Visual features that indicate this situation */
  visualFeatures: string[];
  /** The successful strategy */
  strategy: {
    description: string;
    steps: string[];
    actions: VMAction[];
  };
  /** How many times this worked */
  successCount: number;
  /** How many times this failed */
  failureCount: number;
  /** Last used timestamp */
  lastUsed: number;
  /** Effectiveness score */
  effectiveness: number;
}

/**
 * Application-specific knowledge
 */
export interface ApplicationKnowledge {
  /** Application name */
  application: string;
  /** Known UI patterns */
  uiPatterns: Array<{
    name: string;
    description: string;
    visualSignature?: string;
  }>;
  /** Common workflows */
  workflows: Array<{
    name: string;
    steps: string[];
  }>;
  /** Tips and tricks */
  tips: string[];
  /** Known gotchas */
  gotchas: string[];
  /** Last updated */
  updatedAt: number;
}

// =============================================================================
// WorldBox Specific Types
// =============================================================================

/**
 * WorldBox game state
 */
export interface WorldBoxGameState {
  /** Whether WorldBox is detected */
  detected: boolean;
  /** Current game mode */
  currentMode?: 'menu' | 'game' | 'worldCreation' | 'settings';
  /** Current tool selected */
  selectedTool?: string;
  /** Current category/tab */
  activeCategory?: string;
  /** Visible creatures count */
  creatureCount?: number;
  /** World time/age */
  worldAge?: number;
  /** Current biome if visible */
  currentBiome?: string;
  /** Whether game is paused */
  isPaused?: boolean;
  /** Time speed setting */
  timeSpeed?: number;
  /** UI elements specific to WorldBox */
  uiState: {
    menuOpen: boolean;
    settingsOpen: boolean;
    worldInfoVisible: boolean;
  };
}

/**
 * WorldBox action (game-specific)
 */
export type WorldBoxAction =
  | { type: 'selectTool'; tool: string }
  | { type: 'selectCategory'; category: string }
  | { type: 'paint'; x: number; y: number; brushSize?: number }
  | { type: 'spawn'; creature: string; x: number; y: number }
  | { type: 'terraform'; terrain: string; x: number; y: number }
  | { type: 'useAbility'; ability: string; target?: { x: number; y: number } }
  | { type: 'toggleSpeed'; speed: number }
  | { type: 'openMenu'; menu: string }
  | { type: 'saveWorld'; name: string }
  | { type: 'loadWorld'; name: string };

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * VM Agent configuration
 */
export interface VMAgentConfig {
  /** VM connection settings */
  connection: VMConnectionConfig;
  /** Delay between actions (ms) */
  actionDelayMs: number;
  /** Learning settings */
  learning: {
    /** Enable learning from demonstrations */
    enableLearning: boolean;
    /** Automatically record successful actions */
    autoRecord: boolean;
    /** Minimum confidence to act autonomously */
    autonomyThreshold: number;
    /** Maximum actions per task */
    maxActionsPerTask: number;
  };
  /** Vision settings */
  vision: {
    /** Enable OCR */
    enableOCR: boolean;
    /** Enable UI element detection */
    enableUIDetection: boolean;
    /** Screen capture interval (ms) */
    captureIntervalMs: number;
    /** Whether to use GPU for vision */
    useGPU: boolean;
  };
  /** Safety settings */
  safety: {
    /** Require confirmation for destructive actions */
    confirmDestructive: boolean;
    /** Maximum actions per minute */
    maxActionsPerMinute: number;
    /** Pause on error */
    pauseOnError: boolean;
    /** Allowed applications (empty = all) */
    allowedApplications: string[];
  };
  /** Debug settings */
  debug: {
    /** Save screenshots of each action */
    saveScreenshots: boolean;
    /** Verbose logging */
    verboseLogging: boolean;
    /** Screenshot save directory */
    screenshotDir: string;
  };
}

/**
 * Default VM Agent configuration
 */
export const DEFAULT_VM_AGENT_CONFIG: VMAgentConfig = {
  connection: {
    type: 'vnc',
    host: 'localhost',
    port: 5900,
    autoReconnect: true,
    timeout: 10000,
  },
  actionDelayMs: 300,
  learning: {
    enableLearning: true,
    autoRecord: true,
    autonomyThreshold: 0.7,
    maxActionsPerTask: 100,
  },
  vision: {
    enableOCR: true,
    enableUIDetection: true,
    captureIntervalMs: 500,
    useGPU: true,
  },
  safety: {
    confirmDestructive: true,
    maxActionsPerMinute: 60,
    pauseOnError: true,
    allowedApplications: [],
  },
  debug: {
    saveScreenshots: true,
    verboseLogging: false,
    screenshotDir: '',
  },
};
