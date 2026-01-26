/**
 * Atlas Desktop - User Profile Manager
 * Manages comprehensive user profile with preferences, behaviors, and privacy controls
 *
 * Privacy-First Design:
 * - All data stored locally, never transmitted
 * - User can view, edit, and delete any learned information
 * - Clear explanations of what is being learned
 * - Versioned profile for easy rollback
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { createModuleLogger } from '../utils/logger';
import { getMemoryManager, MemoryManager } from './index';

const logger = createModuleLogger('UserProfile');

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Communication style preferences
 */
export interface CommunicationStyle {
  /** Preferred verbosity: 'brief' | 'balanced' | 'detailed' */
  verbosity: 'brief' | 'balanced' | 'detailed';
  /** Preferred formality level (0-1) */
  formality: number;
  /** Preferred technical depth (0-1) */
  technicalDepth: number;
  /** User's preferred name/nickname */
  preferredName?: string;
  /** Preferred response format */
  preferredFormat: 'conversational' | 'structured' | 'bullet_points';
  /** Whether user prefers humor */
  likesHumor: boolean;
  /** Whether user prefers emoji usage */
  likesEmoji: boolean;
}

/**
 * Time-based activity pattern
 */
export interface ActivityPattern {
  /** Hour of day (0-23) */
  hour: number;
  /** Day of week (0-6, Sunday = 0) */
  dayOfWeek: number;
  /** Number of interactions during this time slot */
  interactionCount: number;
  /** Common topics during this time */
  topTopics: string[];
  /** Average session duration in minutes */
  avgSessionDuration: number;
  /** Common tools used during this time */
  toolsUsed: string[];
}

/**
 * Command/workflow usage statistics
 */
export interface CommandUsage {
  /** Command or action name */
  command: string;
  /** Number of times used */
  usageCount: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Last used timestamp */
  lastUsed: number;
  /** Average execution time in ms */
  avgExecutionTime: number;
  /** Common follow-up commands */
  commonFollowups: string[];
  /** Common contexts when used */
  contexts: string[];
}

/**
 * Topic interest profile
 */
export interface TopicInterest {
  /** Topic name */
  topic: string;
  /** Interest level (0-1) */
  interestLevel: number;
  /** Number of mentions */
  mentionCount: number;
  /** Last discussed timestamp */
  lastDiscussed: number;
  /** Subtopics of interest */
  subtopics: string[];
  /** Sentiment when discussing (-1 to 1) */
  sentiment: number;
}

/**
 * Learned preference from conversations
 */
export interface LearnedPreference {
  /** Unique identifier */
  id: string;
  /** Category of preference */
  category: string;
  /** Key/subject */
  key: string;
  /** Value/preference */
  value: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Source text that led to this preference */
  source: string;
  /** Number of confirmations */
  confirmations: number;
  /** When it was learned */
  learnedAt: number;
  /** When it was last confirmed */
  lastConfirmed: number;
  /** Whether user has explicitly verified this */
  userVerified: boolean;
}

/**
 * Workflow pattern detection
 */
export interface WorkflowPattern {
  /** Workflow name/description */
  name: string;
  /** Sequence of actions/commands */
  steps: string[];
  /** Number of times this workflow was executed */
  executionCount: number;
  /** Typical duration in ms */
  typicalDuration: number;
  /** Common triggers for this workflow */
  triggers: string[];
  /** Whether this is a detected pattern or user-defined */
  isDetected: boolean;
  /** Last executed timestamp */
  lastExecuted: number;
}

/**
 * Coding preference with strong opinion
 * Atlas will express these confidently
 */
export interface CodingPreference {
  /** What the preference is about (e.g., "state management", "naming conventions") */
  topic: string;
  /** The preferred approach */
  preference: string;
  /** Why (if known) */
  reason?: string;
  /** How strongly this is preferred (1-10) */
  strength: number;
  /** Times this preference was reinforced */
  reinforcements: number;
  /** When this was learned */
  learnedAt: number;
  /** Example context where this applies */
  exampleContext?: string;
}

/**
 * A correction the user made
 * Used to avoid repeating mistakes
 */
export interface UserCorrection {
  /** Unique ID */
  id: string;
  /** What Atlas said/did wrong */
  wrong: string;
  /** What the user wanted instead */
  right: string;
  /** Context (what were we working on) */
  context: string;
  /** When this happened */
  timestamp: number;
  /** Category of correction */
  category: 'code' | 'response' | 'behavior' | 'style' | 'other';
  /** Has this been successfully applied */
  applied: boolean;
}

/**
 * Privacy settings for user profile
 */
export interface PrivacySettings {
  /** Enable learning from conversations */
  enableLearning: boolean;
  /** Learn communication style preferences */
  learnCommunicationStyle: boolean;
  /** Track activity patterns (time of day) */
  trackActivityPatterns: boolean;
  /** Track command/tool usage */
  trackCommandUsage: boolean;
  /** Learn topic interests */
  learnTopicInterests: boolean;
  /** Learn personal facts (name, preferences) */
  learnPersonalFacts: boolean;
  /** Detect workflow patterns */
  detectWorkflows: boolean;
  /** Learn coding preferences */
  learnCodingPreferences: boolean;
  /** Learn from corrections */
  learnFromCorrections: boolean;
  /** Data retention period in days (0 = forever) */
  dataRetentionDays: number;
  /** Auto-delete low confidence items */
  autoDeleteLowConfidence: boolean;
  /** Minimum confidence to retain (0-1) */
  minRetentionConfidence: number;
}

/**
 * Complete user profile
 */
export interface UserProfile {
  /** Profile version for migrations */
  version: number;
  /** Profile creation timestamp */
  createdAt: number;
  /** Last updated timestamp */
  updatedAt: number;
  /** Profile ID */
  id: string;

  /** Communication style preferences */
  communicationStyle: CommunicationStyle;
  /** Activity patterns by time */
  activityPatterns: ActivityPattern[];
  /** Command usage statistics */
  commandUsage: Map<string, CommandUsage>;
  /** Topic interests */
  topicInterests: Map<string, TopicInterest>;
  /** Learned preferences */
  preferences: Map<string, LearnedPreference>;
  /** Detected workflow patterns */
  workflows: WorkflowPattern[];
  /** Coding preferences (strong opinions) */
  codingPreferences: CodingPreference[];
  /** User corrections (mistakes to avoid) */
  corrections: UserCorrection[];
  /** Privacy settings */
  privacy: PrivacySettings;

  /** Total interaction count */
  totalInteractions: number;
  /** Total sessions */
  totalSessions: number;
  /** First interaction timestamp */
  firstInteraction: number | null;
  /** Last interaction timestamp */
  lastInteraction: number | null;
}

/**
 * Profile snapshot for versioning
 */
export interface ProfileSnapshot {
  /** Snapshot ID */
  id: string;
  /** Timestamp of snapshot */
  timestamp: number;
  /** Reason for snapshot */
  reason: string;
  /** The profile state at this point */
  profile: UserProfile;
}

/**
 * Profile export format for user transparency
 */
export interface ProfileExport {
  /** Export timestamp */
  exportedAt: number;
  /** Export format version */
  formatVersion: string;
  /** What Atlas has learned about you */
  whatWeKnow: {
    /** Your communication preferences */
    communicationPreferences: Record<string, string>;
    /** Your interests */
    interests: Array<{ topic: string; level: string }>;
    /** Your typical usage patterns */
    usagePatterns: Array<{ description: string }>;
    /** Commands and tools you use most */
    frequentCommands: Array<{ command: string; count: number }>;
    /** Personal facts we've learned */
    personalFacts: Array<{ fact: string; confidence: string }>;
  };
  /** How this data is used */
  howWeUseThis: string[];
  /** Your privacy settings */
  privacySettings: PrivacySettings;
}

// ============================================================================
// Default Values
// ============================================================================

const DEFAULT_COMMUNICATION_STYLE: CommunicationStyle = {
  verbosity: 'balanced',
  formality: 0.5,
  technicalDepth: 0.5,
  preferredName: undefined,
  preferredFormat: 'conversational',
  likesHumor: true,
  likesEmoji: false,
};

/**
 * Ben's specific communication style preferences
 */
export const BEN_COMMUNICATION_STYLE: CommunicationStyle = {
  verbosity: 'balanced',
  formality: 0.6, // Professional with personality
  technicalDepth: 0.9, // Expert level
  preferredName: 'Ben',
  preferredFormat: 'conversational',
  likesHumor: true, // Dry & subtle
  likesEmoji: false, // Never emojis
};

/**
 * Ben's specific privacy settings
 */
export const BEN_PRIVACY_SETTINGS: PrivacySettings = {
  enableLearning: true,
  learnCommunicationStyle: true,
  trackActivityPatterns: true,
  trackCommandUsage: true,
  learnTopicInterests: true,
  learnPersonalFacts: true,
  detectWorkflows: true,
  learnCodingPreferences: true,
  learnFromCorrections: true,
  dataRetentionDays: 0, // Keep forever - full context
  autoDeleteLowConfidence: false, // Use all context
  minRetentionConfidence: 0.1, // Keep most things
};

const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  enableLearning: true,
  learnCommunicationStyle: true,
  trackActivityPatterns: true,
  trackCommandUsage: true,
  learnTopicInterests: true,
  learnPersonalFacts: true,
  detectWorkflows: true,
  learnCodingPreferences: true,
  learnFromCorrections: true,
  dataRetentionDays: 365,
  autoDeleteLowConfidence: true,
  minRetentionConfidence: 0.3,
};

const CURRENT_PROFILE_VERSION = 1;

// ============================================================================
// Profile Events
// ============================================================================

export interface UserProfileEvents {
  /** Profile loaded from storage */
  'profile-loaded': (profile: UserProfile) => void;
  /** Profile saved to storage */
  'profile-saved': () => void;
  /** Preference learned */
  'preference-learned': (preference: LearnedPreference) => void;
  /** Communication style updated */
  'style-updated': (style: CommunicationStyle) => void;
  /** Activity pattern updated */
  'activity-updated': (pattern: ActivityPattern) => void;
  /** Command usage tracked */
  'command-tracked': (usage: CommandUsage) => void;
  /** Topic interest updated */
  'topic-updated': (interest: TopicInterest) => void;
  /** Workflow detected */
  'workflow-detected': (workflow: WorkflowPattern) => void;
  /** Privacy settings changed */
  'privacy-changed': (settings: PrivacySettings) => void;
  /** Profile snapshot created */
  'snapshot-created': (snapshot: ProfileSnapshot) => void;
  /** Profile cleared */
  'profile-cleared': () => void;
  /** Error occurred */
  error: (error: Error) => void;
}

// ============================================================================
// User Profile Manager
// ============================================================================

/**
 * User Profile Manager
 * Manages comprehensive user profile with learning, privacy controls, and versioning
 */
export class UserProfileManager extends EventEmitter {
  private profile: UserProfile;
  private snapshots: ProfileSnapshot[] = [];
  private storageDir: string;
  private memoryManager: MemoryManager | null = null;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private isDirty = false;
  private currentSessionStart: number = Date.now();
  private recentCommands: Array<{ command: string; timestamp: number }> = [];

  private readonly MAX_SNAPSHOTS = 10;
  private readonly AUTO_SAVE_INTERVAL = 60000; // 1 minute
  private readonly WORKFLOW_DETECTION_THRESHOLD = 3;

  constructor(storageDir?: string) {
    super();
    this.storageDir =
      storageDir ||
      path.join(process.env.HOME || process.env.USERPROFILE || '.', '.atlas', 'profile');
    this.profile = this.createDefaultProfile();
    logger.info('UserProfileManager initialized', { storageDir: this.storageDir });
  }

  /**
   * Create a default user profile
   */
  private createDefaultProfile(): UserProfile {
    return {
      version: CURRENT_PROFILE_VERSION,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      id: this.generateId(),
      communicationStyle: { ...DEFAULT_COMMUNICATION_STYLE },
      activityPatterns: [],
      commandUsage: new Map(),
      topicInterests: new Map(),
      preferences: new Map(),
      workflows: [],
      codingPreferences: [],
      corrections: [],
      privacy: { ...DEFAULT_PRIVACY_SETTINGS },
      totalInteractions: 0,
      totalSessions: 0,
      firstInteraction: null,
      lastInteraction: null,
    };
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Initialize the profile manager
   */
  async initialize(): Promise<void> {
    try {
      // Ensure storage directory exists
      await fs.promises.mkdir(this.storageDir, { recursive: true });

      // Connect to memory manager
      this.memoryManager = await getMemoryManager();

      // Load existing profile
      await this.load();

      // Start new session
      this.startSession();

      // Start auto-save
      this.startAutoSave();

      logger.info('UserProfileManager initialized', {
        profileId: this.profile.id,
        totalInteractions: this.profile.totalInteractions,
      });
    } catch (error) {
      logger.error('Failed to initialize UserProfileManager', { error: (error as Error).message });
      this.emit('error', error as Error);
    }
  }

  /**
   * Start a new session
   */
  private startSession(): void {
    this.currentSessionStart = Date.now();
    this.profile.totalSessions++;
    this.profile.updatedAt = Date.now();
    this.isDirty = true;
  }

  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }
    this.autoSaveTimer = setInterval(() => {
      if (this.isDirty) {
        this.save().catch((e) => logger.error('Auto-save failed', { error: (e as Error).message }));
      }
    }, this.AUTO_SAVE_INTERVAL);
  }

  /**
   * Stop auto-save timer
   */
  private stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  // =========================================================================
  // Learning Methods
  // =========================================================================

  /**
   * Record an interaction and learn from it
   */
  recordInteraction(
    userMessage: string,
    assistantResponse: string,
    metadata?: {
      topics?: string[];
      sentiment?: number;
      toolsUsed?: string[];
      duration?: number;
    }
  ): void {
    if (!this.profile.privacy.enableLearning) {
      return;
    }

    const now = Date.now();

    // Update basic stats
    this.profile.totalInteractions++;
    if (!this.profile.firstInteraction) {
      this.profile.firstInteraction = now;
    }
    this.profile.lastInteraction = now;

    // Track activity patterns
    if (this.profile.privacy.trackActivityPatterns) {
      this.updateActivityPattern(metadata?.topics, metadata?.toolsUsed);
    }

    // Learn communication style
    if (this.profile.privacy.learnCommunicationStyle) {
      this.learnCommunicationStyle(userMessage, assistantResponse);
    }

    // Update topic interests
    if (this.profile.privacy.learnTopicInterests && metadata?.topics) {
      for (const topic of metadata.topics) {
        this.updateTopicInterest(topic, metadata.sentiment);
      }
    }

    // Track tools used
    if (this.profile.privacy.trackCommandUsage && metadata?.toolsUsed) {
      for (const tool of metadata.toolsUsed) {
        this.trackCommand(tool, true, metadata.duration);
      }
    }

    this.profile.updatedAt = now;
    this.isDirty = true;
  }

  /**
   * Update activity patterns based on current time
   */
  private updateActivityPattern(topics?: string[], toolsUsed?: string[]): void {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();

    // Find or create pattern for this time slot
    let pattern = this.profile.activityPatterns.find(
      (p) => p.hour === hour && p.dayOfWeek === dayOfWeek
    );

    if (!pattern) {
      pattern = {
        hour,
        dayOfWeek,
        interactionCount: 0,
        topTopics: [],
        avgSessionDuration: 0,
        toolsUsed: [],
      };
      this.profile.activityPatterns.push(pattern);
    }

    pattern.interactionCount++;

    // Update topics
    if (topics) {
      for (const topic of topics) {
        if (!pattern.topTopics.includes(topic)) {
          pattern.topTopics.push(topic);
          if (pattern.topTopics.length > 5) {
            pattern.topTopics.shift();
          }
        }
      }
    }

    // Update tools
    if (toolsUsed) {
      for (const tool of toolsUsed) {
        if (!pattern.toolsUsed.includes(tool)) {
          pattern.toolsUsed.push(tool);
          if (pattern.toolsUsed.length > 5) {
            pattern.toolsUsed.shift();
          }
        }
      }
    }

    // Update session duration
    const sessionDuration = (Date.now() - this.currentSessionStart) / 60000; // minutes
    pattern.avgSessionDuration =
      (pattern.avgSessionDuration * (pattern.interactionCount - 1) + sessionDuration) /
      pattern.interactionCount;

    this.emit('activity-updated', pattern);
  }

  /**
   * Learn communication style from messages
   */
  private learnCommunicationStyle(userMessage: string, _assistantResponse: string): void {
    const style = this.profile.communicationStyle;
    const lowerMessage = userMessage.toLowerCase();

    // Detect verbosity preference
    const wordCount = userMessage.split(/\s+/).length;
    if (wordCount < 10) {
      // User prefers brief
      style.verbosity = this.adjustVerbosity(style.verbosity, 'brief');
    } else if (wordCount > 50) {
      // User prefers detailed
      style.verbosity = this.adjustVerbosity(style.verbosity, 'detailed');
    }

    // Detect formality from language
    const formalIndicators = ['please', 'kindly', 'would you', 'could you', 'thank you'];
    const casualIndicators = ['hey', 'gonna', 'wanna', 'yeah', 'cool', 'awesome'];

    const formalCount = formalIndicators.filter((w) => lowerMessage.includes(w)).length;
    const casualCount = casualIndicators.filter((w) => lowerMessage.includes(w)).length;

    if (formalCount > casualCount) {
      style.formality = Math.min(1, style.formality + 0.05);
    } else if (casualCount > formalCount) {
      style.formality = Math.max(0, style.formality - 0.05);
    }

    // Detect technical depth preference
    const technicalIndicators = [
      'api',
      'code',
      'function',
      'variable',
      'debug',
      'config',
      'terminal',
      'database',
      'server',
      'deploy',
    ];
    const technicalCount = technicalIndicators.filter((w) => lowerMessage.includes(w)).length;
    if (technicalCount > 0) {
      style.technicalDepth = Math.min(1, style.technicalDepth + 0.05 * technicalCount);
    }

    // Detect emoji preference
    const hasEmoji = /[\u{1F300}-\u{1F9FF}]/u.test(userMessage);
    if (hasEmoji) {
      style.likesEmoji = true;
    }

    // Detect format preference
    if (lowerMessage.includes('list') || lowerMessage.includes('bullet')) {
      style.preferredFormat = 'bullet_points';
    } else if (lowerMessage.includes('step by step') || lowerMessage.includes('structured')) {
      style.preferredFormat = 'structured';
    }

    this.emit('style-updated', style);
  }

  /**
   * Adjust verbosity setting
   */
  private adjustVerbosity(
    current: 'brief' | 'balanced' | 'detailed',
    direction: 'brief' | 'detailed'
  ): 'brief' | 'balanced' | 'detailed' {
    if (direction === 'brief') {
      if (current === 'detailed') return 'balanced';
      return 'brief';
    } else {
      if (current === 'brief') return 'balanced';
      return 'detailed';
    }
  }

  /**
   * Update topic interest
   */
  updateTopicInterest(topic: string, sentiment?: number): void {
    if (!this.profile.privacy.learnTopicInterests) return;

    const normalizedTopic = topic.toLowerCase();
    let interest = this.profile.topicInterests.get(normalizedTopic);

    if (!interest) {
      interest = {
        topic: normalizedTopic,
        interestLevel: 0.5,
        mentionCount: 0,
        lastDiscussed: Date.now(),
        subtopics: [],
        sentiment: 0,
      };
      this.profile.topicInterests.set(normalizedTopic, interest);
    }

    interest.mentionCount++;
    interest.lastDiscussed = Date.now();
    interest.interestLevel = Math.min(1, interest.interestLevel + 0.05);

    if (sentiment !== undefined) {
      interest.sentiment =
        (interest.sentiment * (interest.mentionCount - 1) + sentiment) / interest.mentionCount;
    }

    this.emit('topic-updated', interest);
    this.isDirty = true;
  }

  /**
   * Track command/tool usage
   */
  trackCommand(command: string, success: boolean, executionTime?: number, context?: string): void {
    if (!this.profile.privacy.trackCommandUsage) return;

    const normalizedCommand = command.toLowerCase();
    let usage = this.profile.commandUsage.get(normalizedCommand);

    if (!usage) {
      usage = {
        command: normalizedCommand,
        usageCount: 0,
        successRate: 1,
        lastUsed: Date.now(),
        avgExecutionTime: 0,
        commonFollowups: [],
        contexts: [],
      };
      this.profile.commandUsage.set(normalizedCommand, usage);
    }

    usage.usageCount++;
    usage.lastUsed = Date.now();
    usage.successRate =
      (usage.successRate * (usage.usageCount - 1) + (success ? 1 : 0)) / usage.usageCount;

    if (executionTime !== undefined) {
      usage.avgExecutionTime =
        (usage.avgExecutionTime * (usage.usageCount - 1) + executionTime) / usage.usageCount;
    }

    if (context && !usage.contexts.includes(context)) {
      usage.contexts.push(context);
      if (usage.contexts.length > 5) usage.contexts.shift();
    }

    // Track recent commands for workflow detection
    this.recentCommands.push({ command: normalizedCommand, timestamp: Date.now() });
    if (this.recentCommands.length > 20) this.recentCommands.shift();

    // Update followups
    if (this.recentCommands.length >= 2) {
      const prevCommand = this.recentCommands[this.recentCommands.length - 2].command;
      const prevUsage = this.profile.commandUsage.get(prevCommand);
      if (prevUsage && !prevUsage.commonFollowups.includes(normalizedCommand)) {
        prevUsage.commonFollowups.push(normalizedCommand);
        if (prevUsage.commonFollowups.length > 5) prevUsage.commonFollowups.shift();
      }
    }

    // Detect workflows
    if (this.profile.privacy.detectWorkflows) {
      this.detectWorkflows();
    }

    this.emit('command-tracked', usage);
    this.isDirty = true;
  }

  /**
   * Detect workflow patterns from recent commands
   */
  private detectWorkflows(): void {
    if (this.recentCommands.length < 3) return;

    // Look for repeated sequences
    const sequences = new Map<string, number>();

    for (let len = 2; len <= Math.min(5, this.recentCommands.length); len++) {
      for (let i = 0; i <= this.recentCommands.length - len; i++) {
        const seq = this.recentCommands
          .slice(i, i + len)
          .map((c) => c.command)
          .join(' -> ');
        sequences.set(seq, (sequences.get(seq) || 0) + 1);
      }
    }

    // Check for patterns that repeat
    for (const [seq, count] of sequences) {
      if (count >= this.WORKFLOW_DETECTION_THRESHOLD) {
        const steps = seq.split(' -> ');
        const existingWorkflow = this.profile.workflows.find((w) => w.steps.join(' -> ') === seq);

        if (existingWorkflow) {
          existingWorkflow.executionCount = count;
          existingWorkflow.lastExecuted = Date.now();
        } else {
          const workflow: WorkflowPattern = {
            name: `Workflow: ${steps[0]} to ${steps[steps.length - 1]}`,
            steps,
            executionCount: count,
            typicalDuration: 0,
            triggers: [steps[0]],
            isDetected: true,
            lastExecuted: Date.now(),
          };
          this.profile.workflows.push(workflow);
          this.emit('workflow-detected', workflow);
          logger.info('Workflow pattern detected', { steps, count });
        }
      }
    }
  }

  /**
   * Learn a preference from conversation
   */
  learnPreference(
    category: string,
    key: string,
    value: string,
    source: string,
    confidence: number
  ): LearnedPreference | null {
    if (!this.profile.privacy.learnPersonalFacts) return null;
    if (confidence < this.profile.privacy.minRetentionConfidence) return null;

    const prefKey = `${category}:${key}`.toLowerCase();
    let pref = this.profile.preferences.get(prefKey);

    if (pref) {
      // Update existing preference
      if (pref.value.toLowerCase() === value.toLowerCase()) {
        pref.confirmations++;
        pref.confidence = Math.min(1, pref.confidence + 0.1);
        pref.lastConfirmed = Date.now();
      } else {
        // Different value - update if higher confidence
        if (confidence > pref.confidence) {
          pref.value = value;
          pref.source = source;
          pref.confidence = confidence;
          pref.lastConfirmed = Date.now();
        }
      }
    } else {
      // Create new preference
      pref = {
        id: this.generateId(),
        category,
        key,
        value,
        confidence,
        source,
        confirmations: 1,
        learnedAt: Date.now(),
        lastConfirmed: Date.now(),
        userVerified: false,
      };
      this.profile.preferences.set(prefKey, pref);
    }

    this.emit('preference-learned', pref);
    this.isDirty = true;
    return pref;
  }

  /**
   * User explicitly verifies a preference
   */
  verifyPreference(preferenceId: string, isCorrect: boolean): boolean {
    for (const [key, pref] of this.profile.preferences) {
      if (pref.id === preferenceId) {
        if (isCorrect) {
          pref.userVerified = true;
          pref.confidence = 1.0;
          pref.confirmations++;
        } else {
          // User said it's wrong - remove it
          this.profile.preferences.delete(key);
        }
        this.isDirty = true;
        return true;
      }
    }
    return false;
  }

  // =========================================================================
  // Coding Preferences & Corrections Methods
  // =========================================================================

  /**
   * Record a user correction
   * Used to learn from mistakes and avoid repeating them
   */
  recordCorrection(
    wrong: string,
    right: string,
    context: string,
    category: 'code' | 'response' | 'behavior' | 'style' | 'other' = 'other'
  ): UserCorrection | null {
    if (!this.profile.privacy.learnFromCorrections) return null;

    const correction: UserCorrection = {
      id: this.generateId(),
      wrong,
      right,
      context,
      timestamp: Date.now(),
      category,
      applied: false,
    };

    // Initialize corrections array if not present
    if (!this.profile.corrections) {
      this.profile.corrections = [];
    }

    // Check for similar correction (avoid duplicates)
    const existing = this.profile.corrections.find(
      (c) => c.wrong.toLowerCase() === wrong.toLowerCase() && c.category === category
    );

    if (existing) {
      // Update existing correction
      existing.right = right;
      existing.context = context;
      existing.timestamp = Date.now();
      existing.applied = false;
      logger.info('Correction updated', { id: existing.id, category });
      this.isDirty = true;
      return existing;
    }

    this.profile.corrections.push(correction);
    this.isDirty = true;
    logger.info('Correction recorded', { id: correction.id, category });
    return correction;
  }

  /**
   * Mark a correction as applied
   */
  markCorrectionApplied(correctionId: string): boolean {
    if (!this.profile.corrections) return false;

    const correction = this.profile.corrections.find((c) => c.id === correctionId);
    if (correction) {
      correction.applied = true;
      this.isDirty = true;
      return true;
    }
    return false;
  }

  /**
   * Get all corrections, optionally filtered by category
   */
  getCorrections(category?: 'code' | 'response' | 'behavior' | 'style' | 'other'): UserCorrection[] {
    if (!this.profile.corrections) return [];

    if (category) {
      return this.profile.corrections.filter((c) => c.category === category);
    }
    return [...this.profile.corrections];
  }

  /**
   * Learn a coding preference
   * Atlas will express these confidently when relevant
   */
  learnCodingPreference(
    topic: string,
    preference: string,
    reason?: string,
    exampleContext?: string
  ): CodingPreference | null {
    if (!this.profile.privacy.learnCodingPreferences) return null;

    // Initialize codingPreferences array if not present
    if (!this.profile.codingPreferences) {
      this.profile.codingPreferences = [];
    }

    // Check if we already have a preference for this topic
    const existing = this.profile.codingPreferences.find(
      (p) => p.topic.toLowerCase() === topic.toLowerCase()
    );

    if (existing) {
      // Reinforce existing preference
      if (existing.preference.toLowerCase() === preference.toLowerCase()) {
        existing.reinforcements++;
        existing.strength = Math.min(10, existing.strength + 1);
        if (reason && !existing.reason) existing.reason = reason;
        if (exampleContext) existing.exampleContext = exampleContext;
        logger.info('Coding preference reinforced', { topic, strength: existing.strength });
      } else {
        // Different preference - if strong enough, replace
        if (existing.strength < 5) {
          existing.preference = preference;
          existing.reason = reason;
          existing.reinforcements = 1;
          existing.strength = 3;
          existing.learnedAt = Date.now();
          existing.exampleContext = exampleContext;
          logger.info('Coding preference replaced', { topic, preference });
        } else {
          logger.debug('Ignoring conflicting preference - existing is strong', {
            topic,
            existingStrength: existing.strength,
          });
        }
      }
      this.isDirty = true;
      return existing;
    }

    // Create new preference
    const codingPref: CodingPreference = {
      topic,
      preference,
      reason,
      strength: 3,
      reinforcements: 1,
      learnedAt: Date.now(),
      exampleContext,
    };

    this.profile.codingPreferences.push(codingPref);
    this.isDirty = true;
    logger.info('Coding preference learned', { topic, preference });
    return codingPref;
  }

  /**
   * Get coding preferences, optionally filtered by minimum strength
   */
  getCodingPreferences(minStrength?: number): CodingPreference[] {
    if (!this.profile.codingPreferences) return [];

    let prefs = [...this.profile.codingPreferences];
    if (minStrength !== undefined) {
      prefs = prefs.filter((p) => p.strength >= minStrength);
    }
    return prefs.sort((a, b) => b.strength - a.strength);
  }

  /**
   * Build context string for LLM personalization
   * Includes user preferences, corrections, and coding opinions
   */
  buildLLMContext(): string {
    const parts: string[] = [];

    // User name
    if (this.profile.communicationStyle.preferredName) {
      parts.push(`User's preferred name: ${this.profile.communicationStyle.preferredName}`);
    }

    // Communication style
    const style = this.profile.communicationStyle;
    const styleDesc: string[] = [];
    styleDesc.push(`${style.verbosity} responses`);
    if (style.formality > 0.7) styleDesc.push('formal tone');
    else if (style.formality < 0.3) styleDesc.push('casual tone');
    if (style.technicalDepth > 0.7) styleDesc.push('highly technical');
    if (style.likesHumor) styleDesc.push('appreciates humor');
    if (style.likesEmoji) styleDesc.push('likes emoji');
    if (styleDesc.length > 0) {
      parts.push(`Communication style: ${styleDesc.join(', ')}`);
    }

    // Top interests
    const interests = Array.from(this.profile.topicInterests.values())
      .filter((i) => i.interestLevel > 0.5)
      .sort((a, b) => b.interestLevel - a.interestLevel)
      .slice(0, 5)
      .map((i) => i.topic);
    if (interests.length > 0) {
      parts.push(`Topics of interest: ${interests.join(', ')}`);
    }

    // Personal facts
    const facts = Array.from(this.profile.preferences.values())
      .filter((p) => p.category === 'personal' || p.category === 'fact')
      .filter((p) => p.confidence > 0.5)
      .map((p) => `${p.key}: ${p.value}`);
    if (facts.length > 0) {
      parts.push(`Known facts:\n${facts.map((f) => `- ${f}`).join('\n')}`);
    }

    // Coding preferences (strong opinions)
    const codingPrefs = this.getCodingPreferences(5);
    if (codingPrefs.length > 0) {
      const prefsStr = codingPrefs
        .map((p) => {
          let str = `- ${p.topic}: ${p.preference}`;
          if (p.reason) str += ` (${p.reason})`;
          return str;
        })
        .join('\n');
      parts.push(`Strong coding preferences (express confidently):\n${prefsStr}`);
    }

    // Recent corrections (things to avoid)
    const recentCorrections = (this.profile.corrections || [])
      .filter((c) => !c.applied)
      .slice(-5)
      .map((c) => `- Instead of "${c.wrong}", use "${c.right}"`);
    if (recentCorrections.length > 0) {
      parts.push(`User corrections (avoid these):\n${recentCorrections.join('\n')}`);
    }

    return parts.length > 0 ? parts.join('\n\n') : '';
  }

  // =========================================================================
  // Privacy & Control Methods
  // =========================================================================

  /**
   * Update privacy settings
   */
  updatePrivacySettings(settings: Partial<PrivacySettings>): void {
    this.profile.privacy = { ...this.profile.privacy, ...settings };
    this.emit('privacy-changed', this.profile.privacy);
    this.isDirty = true;
    logger.info('Privacy settings updated', { settings });
  }

  /**
   * Get privacy settings
   */
  getPrivacySettings(): PrivacySettings {
    return { ...this.profile.privacy };
  }

  /**
   * Delete specific preference
   */
  deletePreference(preferenceId: string): boolean {
    for (const [key, pref] of this.profile.preferences) {
      if (pref.id === preferenceId) {
        this.profile.preferences.delete(key);
        this.isDirty = true;
        logger.info('Preference deleted', { id: preferenceId });
        return true;
      }
    }
    return false;
  }

  /**
   * Delete preferences by category
   */
  deletePreferencesByCategory(category: string): number {
    let deleted = 0;
    for (const [key, pref] of this.profile.preferences) {
      if (pref.category.toLowerCase() === category.toLowerCase()) {
        this.profile.preferences.delete(key);
        deleted++;
      }
    }
    if (deleted > 0) {
      this.isDirty = true;
      logger.info('Preferences deleted by category', { category, count: deleted });
    }
    return deleted;
  }

  /**
   * Clear all learned data
   */
  clearAllLearnedData(): void {
    // Create snapshot first
    this.createSnapshot('Before clearing all learned data');

    // Clear data
    this.profile.preferences.clear();
    this.profile.topicInterests.clear();
    this.profile.commandUsage.clear();
    this.profile.activityPatterns = [];
    this.profile.workflows = [];
    this.profile.communicationStyle = { ...DEFAULT_COMMUNICATION_STYLE };

    this.isDirty = true;
    this.emit('profile-cleared');
    logger.info('All learned data cleared');
  }

  /**
   * Clear data older than retention period
   */
  enforceDataRetention(): number {
    if (this.profile.privacy.dataRetentionDays === 0) return 0;

    const cutoff = Date.now() - this.profile.privacy.dataRetentionDays * 24 * 60 * 60 * 1000;
    let deleted = 0;

    // Clear old preferences
    for (const [key, pref] of this.profile.preferences) {
      if (pref.lastConfirmed < cutoff && !pref.userVerified) {
        this.profile.preferences.delete(key);
        deleted++;
      }
    }

    // Clear old topic interests
    for (const [key, interest] of this.profile.topicInterests) {
      if (interest.lastDiscussed < cutoff) {
        this.profile.topicInterests.delete(key);
        deleted++;
      }
    }

    // Clear old command usage
    for (const [key, usage] of this.profile.commandUsage) {
      if (usage.lastUsed < cutoff) {
        this.profile.commandUsage.delete(key);
        deleted++;
      }
    }

    if (deleted > 0) {
      this.isDirty = true;
      logger.info('Data retention enforced', { deleted });
    }

    return deleted;
  }

  // =========================================================================
  // Export & Transparency Methods
  // =========================================================================

  /**
   * Export profile for user transparency
   */
  exportProfile(): ProfileExport {
    const preferences: Record<string, string> = {};
    for (const [key, pref] of this.profile.preferences) {
      preferences[key] = pref.value;
    }

    const interests = Array.from(this.profile.topicInterests.values())
      .sort((a, b) => b.interestLevel - a.interestLevel)
      .slice(0, 10)
      .map((i) => ({
        topic: i.topic,
        level: i.interestLevel > 0.7 ? 'High' : i.interestLevel > 0.4 ? 'Medium' : 'Low',
      }));

    const usagePatterns = this.profile.activityPatterns
      .filter((p) => p.interactionCount > 5)
      .map((p) => ({
        description: `${this.getDayName(p.dayOfWeek)} at ${p.hour}:00 - typically discuss: ${p.topTopics.join(', ')}`,
      }));

    const frequentCommands = Array.from(this.profile.commandUsage.values())
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 10)
      .map((c) => ({ command: c.command, count: c.usageCount }));

    const personalFacts = Array.from(this.profile.preferences.values())
      .filter((p) => p.category === 'personal' || p.category === 'fact')
      .map((p) => ({
        fact: `${p.key}: ${p.value}`,
        confidence: p.confidence > 0.8 ? 'High' : p.confidence > 0.5 ? 'Medium' : 'Low',
      }));

    return {
      exportedAt: Date.now(),
      formatVersion: '1.0',
      whatWeKnow: {
        communicationPreferences: {
          verbosity: this.profile.communicationStyle.verbosity,
          formality:
            this.profile.communicationStyle.formality > 0.6
              ? 'Formal'
              : this.profile.communicationStyle.formality < 0.4
                ? 'Casual'
                : 'Balanced',
          technicalLevel:
            this.profile.communicationStyle.technicalDepth > 0.7
              ? 'Technical'
              : this.profile.communicationStyle.technicalDepth < 0.3
                ? 'Non-technical'
                : 'Moderate',
          preferredName: this.profile.communicationStyle.preferredName || 'Not set',
        },
        interests,
        usagePatterns,
        frequentCommands,
        personalFacts,
      },
      howWeUseThis: [
        'Adjust response length and detail based on your verbosity preference',
        'Match your communication style (formal/casual)',
        'Suggest relevant topics and commands based on time of day',
        'Personalize responses using your name and known preferences',
        'Anticipate common workflows and offer shortcuts',
      ],
      privacySettings: this.profile.privacy,
    };
  }

  /**
   * Get day name from day of week
   */
  private getDayName(day: number): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[day];
  }

  /**
   * Get human-readable profile summary
   */
  getProfileSummary(): string {
    const parts: string[] = [];
    const style = this.profile.communicationStyle;

    if (style.preferredName) {
      parts.push(`Preferred name: ${style.preferredName}`);
    }

    parts.push(
      `Communication: ${style.verbosity}, ${
        style.formality > 0.6 ? 'formal' : style.formality < 0.4 ? 'casual' : 'balanced'
      }`
    );

    const topInterests = Array.from(this.profile.topicInterests.values())
      .sort((a, b) => b.interestLevel - a.interestLevel)
      .slice(0, 3)
      .map((i) => i.topic);

    if (topInterests.length > 0) {
      parts.push(`Top interests: ${topInterests.join(', ')}`);
    }

    const topCommands = Array.from(this.profile.commandUsage.values())
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 3)
      .map((c) => c.command);

    if (topCommands.length > 0) {
      parts.push(`Frequently uses: ${topCommands.join(', ')}`);
    }

    return parts.join('. ');
  }

  // =========================================================================
  // Versioning Methods
  // =========================================================================

  /**
   * Create a snapshot of current profile
   */
  createSnapshot(reason: string): ProfileSnapshot {
    const snapshot: ProfileSnapshot = {
      id: this.generateId(),
      timestamp: Date.now(),
      reason,
      profile: this.cloneProfile(),
    };

    this.snapshots.push(snapshot);

    // Keep only recent snapshots
    while (this.snapshots.length > this.MAX_SNAPSHOTS) {
      this.snapshots.shift();
    }

    this.emit('snapshot-created', snapshot);
    logger.info('Profile snapshot created', { reason, id: snapshot.id });

    return snapshot;
  }

  /**
   * Clone current profile
   */
  private cloneProfile(): UserProfile {
    return {
      ...this.profile,
      communicationStyle: { ...this.profile.communicationStyle },
      activityPatterns: [...this.profile.activityPatterns],
      commandUsage: new Map(this.profile.commandUsage),
      topicInterests: new Map(this.profile.topicInterests),
      preferences: new Map(this.profile.preferences),
      workflows: [...this.profile.workflows],
      codingPreferences: [...(this.profile.codingPreferences || [])],
      corrections: [...(this.profile.corrections || [])],
      privacy: { ...this.profile.privacy },
    };
  }

  /**
   * Restore from snapshot
   */
  restoreFromSnapshot(snapshotId: string): boolean {
    const snapshot = this.snapshots.find((s) => s.id === snapshotId);
    if (!snapshot) {
      logger.warn('Snapshot not found', { id: snapshotId });
      return false;
    }

    // Create backup before restore
    this.createSnapshot('Before restore from snapshot');

    // Restore
    this.profile = this.cloneProfileFromSnapshot(snapshot.profile);
    this.isDirty = true;

    logger.info('Profile restored from snapshot', { id: snapshotId });
    return true;
  }

  /**
   * Clone profile from snapshot data
   */
  private cloneProfileFromSnapshot(source: UserProfile): UserProfile {
    return {
      ...source,
      communicationStyle: { ...source.communicationStyle },
      activityPatterns: [...source.activityPatterns],
      commandUsage: new Map(source.commandUsage),
      topicInterests: new Map(source.topicInterests),
      preferences: new Map(source.preferences),
      workflows: [...source.workflows],
      codingPreferences: [...(source.codingPreferences || [])],
      corrections: [...(source.corrections || [])],
      privacy: { ...source.privacy },
      updatedAt: Date.now(),
    };
  }

  /**
   * Get available snapshots
   */
  getSnapshots(): Array<{ id: string; timestamp: number; reason: string }> {
    return this.snapshots.map((s) => ({
      id: s.id,
      timestamp: s.timestamp,
      reason: s.reason,
    }));
  }

  // =========================================================================
  // Getters
  // =========================================================================

  /**
   * Get current profile
   */
  getProfile(): UserProfile {
    return this.cloneProfile();
  }

  /**
   * Get communication style
   */
  getCommunicationStyle(): CommunicationStyle {
    return { ...this.profile.communicationStyle };
  }

  /**
   * Update communication style
   */
  updateCommunicationStyle(style: Partial<CommunicationStyle>): void {
    this.profile.communicationStyle = { ...this.profile.communicationStyle, ...style };
    this.emit('style-updated', this.profile.communicationStyle);
    this.isDirty = true;
  }

  /**
   * Get all preferences
   */
  getPreferences(): LearnedPreference[] {
    return Array.from(this.profile.preferences.values());
  }

  /**
   * Get preferences by category
   */
  getPreferencesByCategory(category: string): LearnedPreference[] {
    return Array.from(this.profile.preferences.values()).filter(
      (p) => p.category.toLowerCase() === category.toLowerCase()
    );
  }

  /**
   * Get topic interests
   */
  getTopicInterests(): TopicInterest[] {
    return Array.from(this.profile.topicInterests.values()).sort(
      (a, b) => b.interestLevel - a.interestLevel
    );
  }

  /**
   * Get command usage stats
   */
  getCommandUsage(): CommandUsage[] {
    return Array.from(this.profile.commandUsage.values()).sort(
      (a, b) => b.usageCount - a.usageCount
    );
  }

  /**
   * Get activity patterns
   */
  getActivityPatterns(): ActivityPattern[] {
    return [...this.profile.activityPatterns];
  }

  /**
   * Get workflows
   */
  getWorkflows(): WorkflowPattern[] {
    return [...this.profile.workflows];
  }

  /**
   * Get profile stats
   */
  getStats(): {
    totalInteractions: number;
    totalSessions: number;
    preferencesCount: number;
    topicsCount: number;
    commandsTracked: number;
    workflowsDetected: number;
    profileAge: number;
  } {
    return {
      totalInteractions: this.profile.totalInteractions,
      totalSessions: this.profile.totalSessions,
      preferencesCount: this.profile.preferences.size,
      topicsCount: this.profile.topicInterests.size,
      commandsTracked: this.profile.commandUsage.size,
      workflowsDetected: this.profile.workflows.length,
      profileAge: this.profile.firstInteraction ? Date.now() - this.profile.firstInteraction : 0,
    };
  }

  /**
   * Get activity suggestion based on current time
   */
  getActivitySuggestion(): {
    suggestedTopics: string[];
    suggestedTools: string[];
    typicalDuration: number;
  } | null {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();

    const pattern = this.profile.activityPatterns.find(
      (p) => p.hour === hour && p.dayOfWeek === dayOfWeek
    );

    if (!pattern || pattern.interactionCount < 3) {
      return null;
    }

    return {
      suggestedTopics: pattern.topTopics,
      suggestedTools: pattern.toolsUsed,
      typicalDuration: pattern.avgSessionDuration,
    };
  }

  // =========================================================================
  // Persistence Methods
  // =========================================================================

  /**
   * Save profile to disk
   */
  async save(): Promise<void> {
    try {
      const data = {
        profile: this.serializeProfile(),
        snapshots: this.snapshots.map((s) => ({
          ...s,
          profile: this.serializeProfile(s.profile),
        })),
        savedAt: Date.now(),
      };

      const filePath = path.join(this.storageDir, 'user-profile.json');
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));

      this.isDirty = false;
      this.emit('profile-saved');
      logger.debug('Profile saved', { file: filePath });
    } catch (error) {
      logger.error('Failed to save profile', { error: (error as Error).message });
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Serialize profile for storage
   */
  private serializeProfile(profile?: UserProfile): Record<string, unknown> {
    const p = profile || this.profile;
    return {
      ...p,
      commandUsage: Array.from(p.commandUsage.entries()),
      topicInterests: Array.from(p.topicInterests.entries()),
      preferences: Array.from(p.preferences.entries()),
    };
  }

  /**
   * Load profile from disk
   */
  async load(): Promise<void> {
    const filePath = path.join(this.storageDir, 'user-profile.json');

    try {
      const exists = await fs.promises
        .access(filePath)
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        logger.info('No existing profile found, using defaults');
        return;
      }

      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      this.profile = this.deserializeProfile(data.profile);

      if (data.snapshots) {
        this.snapshots = data.snapshots.map(
          (s: {
            id: string;
            timestamp: number;
            reason: string;
            profile: Record<string, unknown>;
          }) => ({
            ...s,
            profile: this.deserializeProfile(s.profile),
          })
        );
      }

      // Enforce data retention
      this.enforceDataRetention();

      // Auto-delete low confidence items
      if (this.profile.privacy.autoDeleteLowConfidence) {
        this.cleanupLowConfidenceItems();
      }

      this.emit('profile-loaded', this.profile);
      logger.info('Profile loaded', {
        totalInteractions: this.profile.totalInteractions,
        preferencesCount: this.profile.preferences.size,
      });
    } catch (error) {
      logger.error('Failed to load profile', { error: (error as Error).message });
      this.emit('error', error as Error);
    }
  }

  /**
   * Deserialize profile from storage
   */
  private deserializeProfile(data: Record<string, unknown>): UserProfile {
    return {
      ...(data as UserProfile),
      commandUsage: new Map(data.commandUsage as Array<[string, CommandUsage]>),
      topicInterests: new Map(data.topicInterests as Array<[string, TopicInterest]>),
      preferences: new Map(data.preferences as Array<[string, LearnedPreference]>),
    };
  }

  /**
   * Clean up low confidence items
   */
  private cleanupLowConfidenceItems(): void {
    const minConfidence = this.profile.privacy.minRetentionConfidence;
    let deleted = 0;

    for (const [key, pref] of this.profile.preferences) {
      if (pref.confidence < minConfidence && !pref.userVerified) {
        this.profile.preferences.delete(key);
        deleted++;
      }
    }

    if (deleted > 0) {
      logger.info('Low confidence items cleaned up', { deleted });
      this.isDirty = true;
    }
  }

  /**
   * Shutdown the profile manager
   */
  async shutdown(): Promise<void> {
    this.stopAutoSave();
    if (this.isDirty) {
      await this.save();
    }
    this.removeAllListeners();
    logger.info('UserProfileManager shutdown');
  }

  // Type-safe event emitter methods
  on<K extends keyof UserProfileEvents>(event: K, listener: UserProfileEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof UserProfileEvents>(event: K, listener: UserProfileEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof UserProfileEvents>(
    event: K,
    ...args: Parameters<UserProfileEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let profileManager: UserProfileManager | null = null;

/**
 * Get or create the user profile manager instance
 */
export async function getUserProfileManager(storageDir?: string): Promise<UserProfileManager> {
  if (!profileManager) {
    profileManager = new UserProfileManager(storageDir);
    await profileManager.initialize();
  }
  return profileManager;
}

/**
 * Shutdown the user profile manager
 */
export async function shutdownUserProfileManager(): Promise<void> {
  if (profileManager) {
    await profileManager.shutdown();
    profileManager = null;
  }
}

export default UserProfileManager;
