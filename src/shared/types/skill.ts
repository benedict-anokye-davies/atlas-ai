/**
 * Atlas Desktop - Skill System Types
 * Session 043-A: Define plugin-style skill interface
 *
 * Skills are higher-level abstractions that group related tools
 * and provide context-aware activation and execution.
 */

import type { AgentTool, ActionResult } from './agent';

/**
 * Skill activation trigger types
 */
export type SkillTriggerType =
  | 'keyword' // Triggered by specific words in user query
  | 'intent' // Triggered by detected intent
  | 'context' // Triggered by conversation context
  | 'schedule' // Triggered by time/schedule
  | 'manual' // Manually activated by user
  | 'always'; // Always active

/**
 * Skill activation trigger configuration
 */
export interface SkillTrigger {
  /** Type of trigger */
  type: SkillTriggerType;

  /** Keywords that trigger this skill (for 'keyword' type) */
  keywords?: string[];

  /** Intent patterns that trigger this skill (for 'intent' type) */
  intents?: string[];

  /** Context conditions (for 'context' type) */
  contextConditions?: {
    /** Required topics in conversation */
    topics?: string[];
    /** Required previous actions */
    previousActions?: string[];
    /** Required user state */
    userState?: Record<string, unknown>;
  };

  /** Schedule configuration (for 'schedule' type) */
  schedule?: {
    /** Cron expression */
    cron?: string;
    /** Time of day (HH:mm) */
    timeOfDay?: string;
    /** Days of week (0-6) */
    daysOfWeek?: number[];
  };

  /** Priority when multiple triggers match (higher = more priority) */
  priority?: number;
}

/**
 * Skill capability requirements
 */
export interface SkillCapabilities {
  /** Required capabilities from agent */
  required: string[];

  /** Optional capabilities that enhance the skill */
  optional?: string[];

  /** Whether this skill requires internet */
  requiresInternet?: boolean;

  /** Whether this skill can work offline */
  offlineCapable?: boolean;

  /** Required tools that must be available */
  requiredTools?: string[];
}

/**
 * Skill lifecycle state
 */
export type SkillState =
  | 'uninstalled' // Not installed
  | 'installed' // Installed but not active
  | 'activating' // In process of activating
  | 'active' // Active and ready
  | 'deactivating' // In process of deactivating
  | 'error'; // In error state

/**
 * Skill execution context
 */
export interface SkillContext {
  /** Current user query */
  query: string;

  /** Detected intent (if any) */
  intent?: string;

  /** Conversation history */
  conversationHistory?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;

  /** Current topics in conversation */
  topics?: string[];

  /** User preferences */
  userPreferences?: Record<string, unknown>;

  /** Previous skill results */
  previousResults?: ActionResult[];

  /** Session ID */
  sessionId?: string;

  /** Timestamp */
  timestamp: number;
}

/**
 * Skill execution result
 */
export interface SkillResult {
  /** Whether skill execution was successful */
  success: boolean;

  /** Result data */
  data?: unknown;

  /** Human-readable response */
  response?: string;

  /** Error message if failed */
  error?: string;

  /** Tools that were used */
  toolsUsed?: string[];

  /** Execution time in ms */
  executionTime?: number;

  /** Follow-up actions suggested */
  followUpActions?: string[];

  /** Whether to continue conversation in this skill context */
  continueInContext?: boolean;

  /** Metadata for logging/analytics */
  metadata?: Record<string, unknown>;
}

/**
 * Skill configuration
 */
export interface SkillConfig {
  /** Skill-specific settings */
  settings?: Record<string, unknown>;

  /** Override default triggers */
  triggers?: SkillTrigger[];

  /** Enable/disable specific features */
  features?: Record<string, boolean>;

  /** Timeout for skill execution (ms) */
  timeout?: number;

  /** Maximum retries on failure */
  maxRetries?: number;
}

/**
 * Skill metadata for discovery and display
 */
export interface SkillMetadata {
  /** Display name */
  displayName: string;

  /** Short description */
  description: string;

  /** Long description with usage examples */
  longDescription?: string;

  /** Version string */
  version: string;

  /** Author information */
  author?: {
    name: string;
    email?: string;
    url?: string;
  };

  /** Icon identifier or URL */
  icon?: string;

  /** Category for grouping */
  category: SkillCategory;

  /** Tags for search */
  tags?: string[];

  /** Example queries that activate this skill */
  exampleQueries?: string[];

  /** Documentation URL */
  docsUrl?: string;

  /** Whether this is a built-in skill */
  builtIn?: boolean;
}

/**
 * Skill categories for organization
 */
export type SkillCategory =
  | 'productivity' // Calculator, timer, notes
  | 'communication' // Email, messaging
  | 'information' // Weather, news, search
  | 'entertainment' // Music, media
  | 'development' // Code, git, terminal
  | 'system' // System control, settings
  | 'custom'; // User-defined skills

/**
 * Main Skill interface
 * Defines the contract for all skills in the system
 */
export interface Skill {
  /** Unique identifier for the skill */
  id: string;

  /** Skill metadata */
  metadata: SkillMetadata;

  /** Activation triggers */
  triggers: SkillTrigger[];

  /** Required capabilities */
  capabilities: SkillCapabilities;

  /** Current state */
  state: SkillState;

  /** Tools provided by this skill */
  tools?: AgentTool[];

  /**
   * Initialize the skill
   * Called when skill is first loaded
   */
  initialize?(config?: SkillConfig): Promise<void>;

  /**
   * Activate the skill
   * Called when skill becomes active
   */
  activate?(): Promise<void>;

  /**
   * Deactivate the skill
   * Called when skill is deactivated
   */
  deactivate?(): Promise<void>;

  /**
   * Check if skill should handle given context
   * Returns confidence score 0-1
   */
  shouldHandle(context: SkillContext): Promise<number>;

  /**
   * Execute the skill
   * Main entry point for skill logic
   */
  execute(context: SkillContext): Promise<SkillResult>;

  /**
   * Get current configuration
   */
  getConfig?(): SkillConfig;

  /**
   * Update configuration
   */
  updateConfig?(config: Partial<SkillConfig>): Promise<void>;

  /**
   * Clean up resources
   * Called when skill is uninstalled
   */
  cleanup?(): Promise<void>;
}

/**
 * Skill registration entry
 */
export interface SkillRegistration {
  /** The skill instance */
  skill: Skill;

  /** When skill was registered */
  registeredAt: number;

  /** Whether skill is enabled */
  enabled: boolean;

  /** User configuration overrides */
  userConfig?: SkillConfig;

  /** Error message if in error state */
  error?: string;

  /** Last execution timestamp */
  lastExecuted?: number;

  /** Execution count */
  executionCount?: number;
}

/**
 * Skill manager events
 */
export type SkillManagerEvent =
  | 'skill-registered'
  | 'skill-unregistered'
  | 'skill-activated'
  | 'skill-deactivated'
  | 'skill-executed'
  | 'skill-error'
  | 'skill-config-changed';

/**
 * Skill manager event payloads
 */
export interface SkillManagerEventPayloads {
  'skill-registered': { skillId: string; metadata: SkillMetadata };
  'skill-unregistered': { skillId: string };
  'skill-activated': { skillId: string };
  'skill-deactivated': { skillId: string };
  'skill-executed': { skillId: string; result: SkillResult; executionTime: number };
  'skill-error': { skillId: string; error: string };
  'skill-config-changed': { skillId: string; config: SkillConfig };
}

/**
 * Skill selection result when matching skills to queries
 */
export interface SkillMatch {
  /** The matched skill */
  skill: Skill;

  /** Confidence score 0-1 */
  confidence: number;

  /** Matched trigger */
  matchedTrigger?: SkillTrigger;

  /** Matched keywords (if keyword trigger) */
  matchedKeywords?: string[];
}

/**
 * Default skill configuration
 */
export const DEFAULT_SKILL_CONFIG: SkillConfig = {
  settings: {},
  features: {},
  timeout: 30000,
  maxRetries: 2,
};

/**
 * Skill category display information
 */
export const SKILL_CATEGORY_INFO: Record<
  SkillCategory,
  { label: string; description: string; icon: string }
> = {
  productivity: {
    label: 'Productivity',
    description: 'Tools for getting things done',
    icon: 'briefcase',
  },
  communication: {
    label: 'Communication',
    description: 'Email, messaging, and contacts',
    icon: 'message',
  },
  information: {
    label: 'Information',
    description: 'Weather, news, and search',
    icon: 'search',
  },
  entertainment: {
    label: 'Entertainment',
    description: 'Music, media, and fun',
    icon: 'music',
  },
  development: {
    label: 'Development',
    description: 'Code, git, and terminal',
    icon: 'code',
  },
  system: {
    label: 'System',
    description: 'System control and settings',
    icon: 'settings',
  },
  custom: {
    label: 'Custom',
    description: 'User-defined skills',
    icon: 'puzzle',
  },
};
