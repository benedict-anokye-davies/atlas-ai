/**
 * Atlas Desktop - VM Agent Voice Integration
 *
 * Connects the VM Agent to Atlas's voice pipeline for natural voice control
 * of virtual machines. Enables commands like:
 * - "Connect to my VM"
 * - "Click the start button"
 * - "Type hello world"
 * - "Open Chrome and search for weather"
 * - "Show me what you see"
 *
 * @module vm-agent/integration/voice-integration
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('VMAgentVoice');

// =============================================================================
// Constants
// =============================================================================

export const VOICE_INTEGRATION_CONSTANTS = {
  /** Confidence threshold for action execution */
  ACTION_CONFIDENCE_THRESHOLD: 0.7,

  /** Timeout for voice command processing (ms) */
  COMMAND_TIMEOUT_MS: 30000,

  /** Debounce for rapid commands (ms) */
  COMMAND_DEBOUNCE_MS: 500,

  /** Maximum concurrent voice commands */
  MAX_CONCURRENT_COMMANDS: 1,

  /** Priority levels for commands */
  PRIORITY: {
    CRITICAL: 1, // Emergency stop, disconnect
    HIGH: 2, // Navigation, clicks
    NORMAL: 3, // Text input, queries
    LOW: 4, // Status checks
  } as const,
} as const;

// =============================================================================
// Types
// =============================================================================

/** Voice command intent types */
export type VoiceCommandIntent =
  // Connection management
  | 'vm_connect'
  | 'vm_disconnect'
  | 'vm_status'
  | 'vm_list'
  // Input actions
  | 'vm_click'
  | 'vm_double_click'
  | 'vm_right_click'
  | 'vm_type'
  | 'vm_press_key'
  | 'vm_hotkey'
  | 'vm_scroll'
  // Navigation
  | 'vm_open_app'
  | 'vm_close_app'
  | 'vm_switch_app'
  | 'vm_navigate'
  // Vision
  | 'vm_screenshot'
  | 'vm_describe'
  | 'vm_find_element'
  // Tasks
  | 'vm_execute_task'
  | 'vm_create_workflow'
  | 'vm_run_workflow'
  // Learning
  | 'vm_start_recording'
  | 'vm_stop_recording'
  | 'vm_learn'
  // Control
  | 'vm_pause'
  | 'vm_resume'
  | 'vm_cancel'
  | 'vm_undo';

/** Parsed voice command */
export interface VoiceCommand {
  /** Unique command ID */
  id: string;

  /** Original transcript */
  transcript: string;

  /** Detected intent */
  intent: VoiceCommandIntent;

  /** Confidence score (0-1) */
  confidence: number;

  /** Extracted parameters */
  params: Record<string, unknown>;

  /** Command priority */
  priority: number;

  /** Timestamp */
  timestamp: number;
}

/** Voice command result */
export interface VoiceCommandResult {
  /** Command that was executed */
  command: VoiceCommand;

  /** Whether execution succeeded */
  success: boolean;

  /** Result data */
  data?: unknown;

  /** Error if failed */
  error?: string;

  /** Response to speak back */
  response: string;

  /** Execution duration (ms) */
  duration: number;
}

/** Intent pattern for matching */
interface IntentPattern {
  /** Intent type */
  intent: VoiceCommandIntent;

  /** Regex patterns to match */
  patterns: RegExp[];

  /** Parameter extractors */
  extractors: Array<{
    name: string;
    pattern: RegExp;
    transform?: (match: string) => unknown;
  }>;

  /** Priority level */
  priority: number;

  /** Whether VM must be connected */
  requiresConnection: boolean;
}

/** Voice integration state */
interface VoiceIntegrationState {
  /** Whether currently processing a command */
  processing: boolean;

  /** Current command being processed */
  currentCommand: VoiceCommand | null;

  /** Queue of pending commands */
  commandQueue: VoiceCommand[];

  /** Last command timestamp */
  lastCommandTime: number;

  /** Whether voice control is enabled */
  enabled: boolean;

  /** Whether VM is connected */
  vmConnected: boolean;
}

// =============================================================================
// Intent Patterns
// =============================================================================

const INTENT_PATTERNS: IntentPattern[] = [
  // Connection commands
  {
    intent: 'vm_connect',
    patterns: [
      /connect\s+(?:to\s+)?(?:the\s+)?(?:vm|virtual\s*machine|computer)/i,
      /(?:start|open)\s+(?:the\s+)?vm/i,
      /(?:vm|virtual\s*machine)\s+connect/i,
    ],
    extractors: [
      {
        name: 'vmName',
        pattern: /connect\s+(?:to\s+)?(?:the\s+)?(?:vm\s+)?(?:named?\s+)?["']?(\w+)["']?/i,
      },
      {
        name: 'protocol',
        pattern: /(?:using|via|with)\s+(vnc|rdp|hyperv|virtualbox|vmware)/i,
        transform: (m) => m.toLowerCase(),
      },
    ],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.HIGH,
    requiresConnection: false,
  },
  {
    intent: 'vm_disconnect',
    patterns: [
      /disconnect\s+(?:from\s+)?(?:the\s+)?(?:vm|virtual\s*machine)/i,
      /(?:close|stop)\s+(?:the\s+)?(?:vm|virtual\s*machine)\s+connection/i,
      /vm\s+disconnect/i,
    ],
    extractors: [],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.CRITICAL,
    requiresConnection: true,
  },
  {
    intent: 'vm_status',
    patterns: [
      /(?:what(?:'s| is)\s+)?(?:the\s+)?(?:vm|virtual\s*machine)\s+status/i,
      /(?:is\s+)?(?:the\s+)?vm\s+(?:connected|running|ready)/i,
      /vm\s+(?:status|state)/i,
    ],
    extractors: [],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.LOW,
    requiresConnection: false,
  },

  // Click commands
  {
    intent: 'vm_click',
    patterns: [
      /click\s+(?:on\s+)?(?:the\s+)?(.+)/i,
      /press\s+(?:the\s+)?(.+)\s+button/i,
      /tap\s+(?:on\s+)?(?:the\s+)?(.+)/i,
    ],
    extractors: [
      {
        name: 'target',
        pattern: /click\s+(?:on\s+)?(?:the\s+)?(.+)/i,
      },
      {
        name: 'x',
        pattern: /(?:at\s+)?(\d+)\s*,?\s*(\d+)/,
        transform: (m) => parseInt(m, 10),
      },
    ],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.HIGH,
    requiresConnection: true,
  },
  {
    intent: 'vm_double_click',
    patterns: [
      /double\s*click\s+(?:on\s+)?(?:the\s+)?(.+)/i,
      /open\s+(?:the\s+)?(.+)\s+(?:file|folder|icon)/i,
    ],
    extractors: [
      {
        name: 'target',
        pattern: /(?:double\s*click|open)\s+(?:on\s+)?(?:the\s+)?(.+)/i,
      },
    ],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.HIGH,
    requiresConnection: true,
  },
  {
    intent: 'vm_right_click',
    patterns: [
      /right\s*click\s+(?:on\s+)?(?:the\s+)?(.+)/i,
      /context\s+menu\s+(?:on\s+)?(?:the\s+)?(.+)/i,
    ],
    extractors: [
      {
        name: 'target',
        pattern: /right\s*click\s+(?:on\s+)?(?:the\s+)?(.+)/i,
      },
    ],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.HIGH,
    requiresConnection: true,
  },

  // Type commands
  {
    intent: 'vm_type',
    patterns: [
      /type\s+["']?(.+?)["']?$/i,
      /enter\s+(?:the\s+)?(?:text\s+)?["']?(.+?)["']?$/i,
      /write\s+["']?(.+?)["']?$/i,
      /input\s+["']?(.+?)["']?$/i,
    ],
    extractors: [
      {
        name: 'text',
        pattern: /(?:type|enter|write|input)\s+(?:the\s+)?(?:text\s+)?["']?(.+?)["']?$/i,
      },
    ],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.NORMAL,
    requiresConnection: true,
  },
  {
    intent: 'vm_press_key',
    patterns: [
      /press\s+(?:the\s+)?(\w+)\s*(?:key)?/i,
      /hit\s+(?:the\s+)?(\w+)/i,
    ],
    extractors: [
      {
        name: 'key',
        pattern: /(?:press|hit)\s+(?:the\s+)?(\w+)/i,
        transform: (m) => m.toLowerCase(),
      },
    ],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.HIGH,
    requiresConnection: true,
  },
  {
    intent: 'vm_hotkey',
    patterns: [
      /(?:press\s+)?(?:control|ctrl|alt|shift|command|cmd|windows|win)\s*\+\s*\w+/i,
      /(?:hotkey|shortcut|keyboard\s+shortcut)\s+(.+)/i,
    ],
    extractors: [
      {
        name: 'keys',
        pattern: /((?:control|ctrl|alt|shift|command|cmd|windows|win)(?:\s*\+\s*\w+)+)/i,
        transform: (m) =>
          m
            .split(/\s*\+\s*/)
            .map((k) => k.trim().toLowerCase())
            .filter(Boolean),
      },
    ],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.HIGH,
    requiresConnection: true,
  },

  // Scroll commands
  {
    intent: 'vm_scroll',
    patterns: [
      /scroll\s+(up|down|left|right)/i,
      /(?:page\s+)?(up|down)/i,
    ],
    extractors: [
      {
        name: 'direction',
        pattern: /scroll\s+(up|down|left|right)|(?:page\s+)?(up|down)/i,
        transform: (m) => m.toLowerCase(),
      },
      {
        name: 'amount',
        pattern: /(\d+)\s+(?:times|lines|pages)/i,
        transform: (m) => parseInt(m, 10),
      },
    ],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.NORMAL,
    requiresConnection: true,
  },

  // App management
  {
    intent: 'vm_open_app',
    patterns: [
      /open\s+(?:the\s+)?(.+?)(?:\s+app(?:lication)?)?$/i,
      /launch\s+(?:the\s+)?(.+)/i,
      /start\s+(?:the\s+)?(.+)/i,
      /run\s+(?:the\s+)?(.+)/i,
    ],
    extractors: [
      {
        name: 'appName',
        pattern: /(?:open|launch|start|run)\s+(?:the\s+)?(.+?)(?:\s+app(?:lication)?)?$/i,
      },
    ],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.HIGH,
    requiresConnection: true,
  },
  {
    intent: 'vm_close_app',
    patterns: [
      /close\s+(?:the\s+)?(.+?)(?:\s+app(?:lication)?)?$/i,
      /quit\s+(?:the\s+)?(.+)/i,
      /exit\s+(?:the\s+)?(.+)/i,
    ],
    extractors: [
      {
        name: 'appName',
        pattern: /(?:close|quit|exit)\s+(?:the\s+)?(.+?)(?:\s+app(?:lication)?)?$/i,
      },
    ],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.HIGH,
    requiresConnection: true,
  },
  {
    intent: 'vm_switch_app',
    patterns: [
      /switch\s+to\s+(?:the\s+)?(.+)/i,
      /go\s+to\s+(?:the\s+)?(.+)/i,
      /focus\s+(?:on\s+)?(?:the\s+)?(.+)/i,
    ],
    extractors: [
      {
        name: 'appName',
        pattern: /(?:switch|go|focus)\s+(?:to\s+)?(?:on\s+)?(?:the\s+)?(.+)/i,
      },
    ],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.HIGH,
    requiresConnection: true,
  },

  // Vision commands
  {
    intent: 'vm_screenshot',
    patterns: [
      /(?:take\s+a?\s*)?screenshot/i,
      /capture\s+(?:the\s+)?screen/i,
      /show\s+(?:me\s+)?(?:the\s+)?screen/i,
      /what(?:'s| is)\s+on\s+(?:the\s+)?screen/i,
    ],
    extractors: [],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.NORMAL,
    requiresConnection: true,
  },
  {
    intent: 'vm_describe',
    patterns: [
      /describe\s+(?:the\s+)?screen/i,
      /what\s+(?:do\s+you\s+)?see/i,
      /what(?:'s| is)\s+(?:on\s+)?(?:the\s+)?(?:screen|display)/i,
      /tell\s+me\s+what(?:'s| is)\s+(?:on\s+)?(?:the\s+)?screen/i,
    ],
    extractors: [],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.NORMAL,
    requiresConnection: true,
  },
  {
    intent: 'vm_find_element',
    patterns: [
      /find\s+(?:the\s+)?(.+)/i,
      /locate\s+(?:the\s+)?(.+)/i,
      /where\s+is\s+(?:the\s+)?(.+)/i,
      /can\s+you\s+see\s+(?:the\s+)?(.+)/i,
    ],
    extractors: [
      {
        name: 'query',
        pattern: /(?:find|locate|where\s+is|can\s+you\s+see)\s+(?:the\s+)?(.+)/i,
      },
    ],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.NORMAL,
    requiresConnection: true,
  },

  // Task execution
  {
    intent: 'vm_execute_task',
    patterns: [
      /(?:execute|run|do|perform)\s+(?:the\s+)?(?:task\s+)?["']?(.+?)["']?$/i,
      /(?:can\s+you\s+)?(.+)\s+for\s+me/i,
      /please\s+(.+)/i,
    ],
    extractors: [
      {
        name: 'task',
        pattern:
          /(?:execute|run|do|perform|please)\s+(?:the\s+)?(?:task\s+)?["']?(.+?)["']?(?:\s+for\s+me)?$/i,
      },
    ],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.NORMAL,
    requiresConnection: true,
  },

  // Recording/Learning
  {
    intent: 'vm_start_recording',
    patterns: [
      /start\s+recording/i,
      /begin\s+recording/i,
      /record\s+(?:this|a\s+new)\s+(?:task|workflow|demo)/i,
      /(?:let\s+me\s+)?show\s+you\s+how/i,
      /watch\s+(?:and\s+)?learn/i,
    ],
    extractors: [
      {
        name: 'name',
        pattern: /(?:call(?:ed)?|named?)\s+["']?(.+?)["']?$/i,
      },
    ],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.HIGH,
    requiresConnection: true,
  },
  {
    intent: 'vm_stop_recording',
    patterns: [
      /stop\s+recording/i,
      /end\s+recording/i,
      /finish\s+recording/i,
      /(?:that(?:'s| is)\s+)?(?:done|it|all)/i,
    ],
    extractors: [],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.HIGH,
    requiresConnection: true,
  },

  // Control commands
  {
    intent: 'vm_pause',
    patterns: [
      /pause/i,
      /wait/i,
      /hold\s+on/i,
      /stop\s+(?:for\s+)?(?:a\s+)?(?:moment|second|bit)/i,
    ],
    extractors: [],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.CRITICAL,
    requiresConnection: true,
  },
  {
    intent: 'vm_resume',
    patterns: [
      /resume/i,
      /continue/i,
      /go\s+(?:ahead|on)/i,
      /(?:okay|ok)\s*,?\s*(?:go|continue)/i,
    ],
    extractors: [],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.CRITICAL,
    requiresConnection: true,
  },
  {
    intent: 'vm_cancel',
    patterns: [
      /cancel/i,
      /abort/i,
      /stop\s+(?:that|this|it)/i,
      /never\s*mind/i,
    ],
    extractors: [],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.CRITICAL,
    requiresConnection: true,
  },
  {
    intent: 'vm_undo',
    patterns: [
      /undo/i,
      /go\s+back/i,
      /revert/i,
      /undo\s+(?:that|the\s+last\s+action)/i,
    ],
    extractors: [],
    priority: VOICE_INTEGRATION_CONSTANTS.PRIORITY.HIGH,
    requiresConnection: true,
  },
];

// =============================================================================
// Voice Integration Manager
// =============================================================================

/**
 * Manages voice command integration for VM Agent
 */
export class VoiceIntegrationManager extends EventEmitter {
  private state: VoiceIntegrationState = {
    processing: false,
    currentCommand: null,
    commandQueue: [],
    lastCommandTime: 0,
    enabled: true,
    vmConnected: false,
  };

  private commandHandlers: Map<
    VoiceCommandIntent,
    (command: VoiceCommand) => Promise<VoiceCommandResult>
  > = new Map();

  private commandIdCounter = 0;

  constructor() {
    super();
    this.registerDefaultHandlers();
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Process a voice transcript and execute matching command
   */
  async processTranscript(transcript: string): Promise<VoiceCommandResult | null> {
    if (!this.state.enabled) {
      logger.debug('Voice integration disabled, ignoring transcript');
      return null;
    }

    // Debounce rapid commands
    const now = Date.now();
    if (now - this.state.lastCommandTime < VOICE_INTEGRATION_CONSTANTS.COMMAND_DEBOUNCE_MS) {
      logger.debug('Command debounced');
      return null;
    }
    this.state.lastCommandTime = now;

    // Parse the command
    const command = this.parseTranscript(transcript);
    if (!command) {
      logger.debug('No matching command found', { transcript });
      return null;
    }

    // Check confidence
    if (command.confidence < VOICE_INTEGRATION_CONSTANTS.ACTION_CONFIDENCE_THRESHOLD) {
      logger.debug('Command confidence too low', {
        intent: command.intent,
        confidence: command.confidence,
      });
      return {
        command,
        success: false,
        error: 'Low confidence',
        response: "I'm not sure what you meant. Could you try again?",
        duration: 0,
      };
    }

    // Check connection requirement
    const pattern = INTENT_PATTERNS.find((p) => p.intent === command.intent);
    if (pattern?.requiresConnection && !this.state.vmConnected) {
      return {
        command,
        success: false,
        error: 'VM not connected',
        response: "I'm not connected to a VM. Say 'connect to VM' first.",
        duration: 0,
      };
    }

    // Queue or execute
    if (this.state.processing) {
      this.state.commandQueue.push(command);
      logger.debug('Command queued', { intent: command.intent, queueLength: this.state.commandQueue.length });
      return null;
    }

    return this.executeCommand(command);
  }

  /**
   * Parse transcript into a command
   */
  parseTranscript(transcript: string): VoiceCommand | null {
    const normalizedTranscript = transcript.trim().toLowerCase();

    let bestMatch: { pattern: IntentPattern; confidence: number; params: Record<string, unknown> } | null =
      null;

    for (const intentPattern of INTENT_PATTERNS) {
      for (const regex of intentPattern.patterns) {
        const match = normalizedTranscript.match(regex);
        if (match) {
          // Calculate confidence based on match quality
          const matchLength = match[0].length;
          const confidence = Math.min(0.5 + (matchLength / transcript.length) * 0.5, 1.0);

          if (!bestMatch || confidence > bestMatch.confidence) {
            // Extract parameters
            const params: Record<string, unknown> = {};
            for (const extractor of intentPattern.extractors) {
              const paramMatch = transcript.match(extractor.pattern);
              if (paramMatch && paramMatch[1]) {
                params[extractor.name] = extractor.transform
                  ? extractor.transform(paramMatch[1])
                  : paramMatch[1].trim();
              }
            }

            bestMatch = {
              pattern: intentPattern,
              confidence,
              params,
            };
          }
        }
      }
    }

    if (!bestMatch) {
      return null;
    }

    return {
      id: `cmd_${++this.commandIdCounter}`,
      transcript,
      intent: bestMatch.pattern.intent,
      confidence: bestMatch.confidence,
      params: bestMatch.params,
      priority: bestMatch.pattern.priority,
      timestamp: Date.now(),
    };
  }

  /**
   * Execute a parsed command
   */
  async executeCommand(command: VoiceCommand): Promise<VoiceCommandResult> {
    const startTime = Date.now();
    this.state.processing = true;
    this.state.currentCommand = command;

    this.emit('command:start', command);
    logger.info('Executing voice command', { intent: command.intent, params: command.params });

    try {
      const handler = this.commandHandlers.get(command.intent);
      if (!handler) {
        return {
          command,
          success: false,
          error: 'No handler registered',
          response: "I don't know how to do that yet.",
          duration: Date.now() - startTime,
        };
      }

      const result = await Promise.race([
        handler(command),
        new Promise<VoiceCommandResult>((_, reject) =>
          setTimeout(
            () => reject(new Error('Command timeout')),
            VOICE_INTEGRATION_CONSTANTS.COMMAND_TIMEOUT_MS,
          ),
        ),
      ]);

      result.duration = Date.now() - startTime;
      this.emit('command:complete', result);
      logger.info('Voice command completed', {
        intent: command.intent,
        success: result.success,
        duration: result.duration,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const result: VoiceCommandResult = {
        command,
        success: false,
        error: errorMessage,
        response: `Sorry, something went wrong: ${errorMessage}`,
        duration: Date.now() - startTime,
      };

      this.emit('command:error', result);
      logger.error('Voice command failed', { intent: command.intent, error: errorMessage });

      return result;
    } finally {
      this.state.processing = false;
      this.state.currentCommand = null;

      // Process queued commands
      if (this.state.commandQueue.length > 0) {
        const nextCommand = this.state.commandQueue.shift()!;
        setImmediate(() => this.executeCommand(nextCommand));
      }
    }
  }

  /**
   * Register a command handler
   */
  registerHandler(
    intent: VoiceCommandIntent,
    handler: (command: VoiceCommand) => Promise<VoiceCommandResult>,
  ): void {
    this.commandHandlers.set(intent, handler);
  }

  /**
   * Update VM connection state
   */
  setVMConnected(connected: boolean): void {
    this.state.vmConnected = connected;
    this.emit('vm:connection', connected);
  }

  /**
   * Enable/disable voice integration
   */
  setEnabled(enabled: boolean): void {
    this.state.enabled = enabled;
    this.emit('enabled', enabled);
  }

  /**
   * Get current state
   */
  getState(): Readonly<VoiceIntegrationState> {
    return { ...this.state };
  }

  /**
   * Cancel current command
   */
  cancelCurrentCommand(): void {
    if (this.state.currentCommand) {
      this.emit('command:cancelled', this.state.currentCommand);
      // Handler will be interrupted on next await
    }
  }

  /**
   * Clear command queue
   */
  clearQueue(): void {
    const queueLength = this.state.commandQueue.length;
    this.state.commandQueue = [];
    logger.debug('Command queue cleared', { clearedCount: queueLength });
  }

  // ===========================================================================
  // Default Handlers (Placeholder implementations)
  // ===========================================================================

  private registerDefaultHandlers(): void {
    // Connection handlers
    this.registerHandler('vm_connect', async (cmd) => {
      const vmName = (cmd.params.vmName as string) || 'default';
      // TODO: Integrate with VMAgent
      return {
        command: cmd,
        success: true,
        data: { vmName },
        response: `Connecting to ${vmName}...`,
        duration: 0,
      };
    });

    this.registerHandler('vm_disconnect', async (cmd) => {
      return {
        command: cmd,
        success: true,
        response: 'Disconnected from VM.',
        duration: 0,
      };
    });

    this.registerHandler('vm_status', async (cmd) => {
      const connected = this.state.vmConnected;
      return {
        command: cmd,
        success: true,
        data: { connected },
        response: connected ? 'VM is connected and ready.' : 'Not connected to any VM.',
        duration: 0,
      };
    });

    // Click handlers
    this.registerHandler('vm_click', async (cmd) => {
      const target = cmd.params.target as string;
      return {
        command: cmd,
        success: true,
        data: { target },
        response: `Clicking on ${target}...`,
        duration: 0,
      };
    });

    this.registerHandler('vm_double_click', async (cmd) => {
      const target = cmd.params.target as string;
      return {
        command: cmd,
        success: true,
        data: { target },
        response: `Double-clicking ${target}...`,
        duration: 0,
      };
    });

    // Type handler
    this.registerHandler('vm_type', async (cmd) => {
      const text = cmd.params.text as string;
      return {
        command: cmd,
        success: true,
        data: { text },
        response: `Typing "${text}"...`,
        duration: 0,
      };
    });

    // Key handlers
    this.registerHandler('vm_press_key', async (cmd) => {
      const key = cmd.params.key as string;
      return {
        command: cmd,
        success: true,
        data: { key },
        response: `Pressing ${key}...`,
        duration: 0,
      };
    });

    this.registerHandler('vm_hotkey', async (cmd) => {
      const keys = cmd.params.keys as string[];
      return {
        command: cmd,
        success: true,
        data: { keys },
        response: `Pressing ${keys?.join(' + ') || 'hotkey'}...`,
        duration: 0,
      };
    });

    // Scroll handler
    this.registerHandler('vm_scroll', async (cmd) => {
      const direction = cmd.params.direction as string;
      const amount = (cmd.params.amount as number) || 1;
      return {
        command: cmd,
        success: true,
        data: { direction, amount },
        response: `Scrolling ${direction}...`,
        duration: 0,
      };
    });

    // App handlers
    this.registerHandler('vm_open_app', async (cmd) => {
      const appName = cmd.params.appName as string;
      return {
        command: cmd,
        success: true,
        data: { appName },
        response: `Opening ${appName}...`,
        duration: 0,
      };
    });

    this.registerHandler('vm_close_app', async (cmd) => {
      const appName = cmd.params.appName as string;
      return {
        command: cmd,
        success: true,
        data: { appName },
        response: `Closing ${appName}...`,
        duration: 0,
      };
    });

    this.registerHandler('vm_switch_app', async (cmd) => {
      const appName = cmd.params.appName as string;
      return {
        command: cmd,
        success: true,
        data: { appName },
        response: `Switching to ${appName}...`,
        duration: 0,
      };
    });

    // Vision handlers
    this.registerHandler('vm_screenshot', async (cmd) => {
      return {
        command: cmd,
        success: true,
        response: 'Taking a screenshot...',
        duration: 0,
      };
    });

    this.registerHandler('vm_describe', async (cmd) => {
      return {
        command: cmd,
        success: true,
        response: 'Let me describe what I see...',
        duration: 0,
      };
    });

    this.registerHandler('vm_find_element', async (cmd) => {
      const query = cmd.params.query as string;
      return {
        command: cmd,
        success: true,
        data: { query },
        response: `Looking for ${query}...`,
        duration: 0,
      };
    });

    // Task handler
    this.registerHandler('vm_execute_task', async (cmd) => {
      const task = cmd.params.task as string;
      return {
        command: cmd,
        success: true,
        data: { task },
        response: `I'll do that for you: ${task}`,
        duration: 0,
      };
    });

    // Recording handlers
    this.registerHandler('vm_start_recording', async (cmd) => {
      const name = (cmd.params.name as string) || 'New Recording';
      return {
        command: cmd,
        success: true,
        data: { name },
        response: `Started recording "${name}". Show me what to do.`,
        duration: 0,
      };
    });

    this.registerHandler('vm_stop_recording', async (cmd) => {
      return {
        command: cmd,
        success: true,
        response: "Got it! I've saved the recording.",
        duration: 0,
      };
    });

    // Control handlers
    this.registerHandler('vm_pause', async (cmd) => {
      return {
        command: cmd,
        success: true,
        response: 'Paused.',
        duration: 0,
      };
    });

    this.registerHandler('vm_resume', async (cmd) => {
      return {
        command: cmd,
        success: true,
        response: 'Resuming...',
        duration: 0,
      };
    });

    this.registerHandler('vm_cancel', async (cmd) => {
      return {
        command: cmd,
        success: true,
        response: 'Cancelled.',
        duration: 0,
      };
    });

    this.registerHandler('vm_undo', async (cmd) => {
      return {
        command: cmd,
        success: true,
        response: 'Undoing last action...',
        duration: 0,
      };
    });
  }
}

// =============================================================================
// Singleton
// =============================================================================

let voiceIntegrationInstance: VoiceIntegrationManager | null = null;

/**
 * Get the voice integration manager singleton
 */
export function getVoiceIntegrationManager(): VoiceIntegrationManager {
  if (!voiceIntegrationInstance) {
    voiceIntegrationInstance = new VoiceIntegrationManager();
  }
  return voiceIntegrationInstance;
}

/**
 * Reset the voice integration manager (for testing)
 */
export function resetVoiceIntegrationManager(): void {
  if (voiceIntegrationInstance) {
    voiceIntegrationInstance.removeAllListeners();
    voiceIntegrationInstance = null;
  }
}

/**
 * Connect voice integration to Atlas voice pipeline
 */
export function connectToVoicePipeline(voicePipeline: EventEmitter): void {
  const voiceIntegration = getVoiceIntegrationManager();

  // Listen for transcriptions from voice pipeline
  voicePipeline.on('transcription', async (transcript: string) => {
    // Check if this looks like a VM command
    const isVMCommand =
      /\b(vm|virtual\s*machine|computer|click|type|scroll|open|close|screenshot|describe)\b/i.test(
        transcript,
      );

    if (isVMCommand) {
      const result = await voiceIntegration.processTranscript(transcript);
      if (result) {
        voicePipeline.emit('vm-command-result', result);
      }
    }
  });

  // Forward VM agent state changes
  voiceIntegration.on('vm:connection', (connected) => {
    voicePipeline.emit('vm-connection', connected);
  });

  logger.info('Voice integration connected to voice pipeline');
}
