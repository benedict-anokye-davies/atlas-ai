/**
 * Atlas Desktop - Selective Forgetting
 * Voice command detection and handling for "don't remember this" functionality
 *
 * Features:
 * - Detects forget commands in user messages
 * - Supports multiple phrasings ("don't remember", "forget this", etc.)
 * - Integrates with ConversationMemory and ForgettingManager
 * - Provides user-facing responses
 */

import { createModuleLogger } from '../utils/logger';
import { getConversationMemory } from './conversation-memory';
import { getForgettingManager } from './forgetting';
import { forgetNotes } from './note-writer';
import { clamp01 } from '../../shared/utils';

const logger = createModuleLogger('SelectiveForgetting');

// ============================================================================
// Types
// ============================================================================

/**
 * Types of forget commands
 */
export type ForgetCommandType =
  | 'forget_conversation' // Forget the entire current conversation
  | 'forget_last' // Forget the last exchange
  | 'forget_specific' // Forget something specific (by content/ID)
  | 'forget_topic' // Forget everything about a topic
  | 'forget_note' // Forget a specific note
  | 'forget_time_range' // Forget memories from a time range
  | 'dont_store'; // Don't store this conversation to vault

/**
 * Parsed forget command
 */
export interface ForgetCommand {
  /** Type of forget command detected */
  type: ForgetCommandType;
  /** Confidence score (0-1) */
  confidence: number;
  /** Original user message */
  originalMessage: string;
  /** Extracted target (topic, ID, etc.) */
  target?: string;
  /** Number of items to forget (for "last N" commands) */
  count?: number;
  /** Time range for time-based forgetting */
  timeRange?: { start: Date; end: Date };
}

/**
 * Result of executing a forget command
 */
export interface ForgetResult {
  /** Whether the command was executed successfully */
  success: boolean;
  /** Type of command that was executed */
  commandType: ForgetCommandType;
  /** Human-readable response message */
  response: string;
  /** Number of items affected */
  itemsAffected: number;
  /** Details about what was forgotten */
  details?: {
    turnsRemoved?: number;
    memoriesRemoved?: number;
    notesRemoved?: number;
  };
}

// ============================================================================
// Forget Command Patterns
// ============================================================================

/**
 * Patterns for detecting forget commands in user messages
 */
const FORGET_PATTERNS: Array<{
  pattern: RegExp;
  type: ForgetCommandType;
  extractTarget?: (match: RegExpMatchArray) => { target?: string; count?: number };
}> = [
  // "Don't remember this conversation" / "Forget this conversation"
  {
    pattern:
      /(?:don'?t|do not|never)\s+(?:remember|store|save|keep)\s+(?:this|the)\s+(?:conversation|chat|session)/i,
    type: 'forget_conversation',
  },
  {
    pattern: /forget\s+(?:this|the)\s+(?:entire\s+)?(?:conversation|chat|session)/i,
    type: 'forget_conversation',
  },
  {
    pattern: /(?:clear|erase|delete|wipe)\s+(?:this|the)\s+(?:conversation|chat|session)/i,
    type: 'forget_conversation',
  },

  // "Don't remember this" (current exchange)
  {
    pattern:
      /(?:don'?t|do not|never)\s+(?:remember|store|save|keep)\s+this(?:\s+(?:part|exchange|message))?$/i,
    type: 'forget_last',
  },
  {
    pattern: /forget\s+(?:what\s+)?(?:I\s+)?just\s+(?:said|told\s+you|asked)/i,
    type: 'forget_last',
  },
  {
    pattern: /(?:don'?t|do not)\s+(?:store|save)\s+that/i,
    type: 'forget_last',
  },
  {
    pattern: /(?:strike|remove)\s+that\s+from\s+(?:the\s+)?(?:record|memory)/i,
    type: 'forget_last',
  },

  // "Forget the last N things"
  {
    pattern: /forget\s+(?:the\s+)?last\s+(\d+)\s+(?:things?|exchanges?|messages?|turns?)/i,
    type: 'forget_last',
    extractTarget: (match) => ({ count: parseInt(match[1], 10) }),
  },

  // "Forget everything about X"
  {
    pattern: /forget\s+(?:everything|all)\s+(?:about|regarding|related\s+to)\s+(.+)/i,
    type: 'forget_topic',
    extractTarget: (match) => ({ target: match[1].trim() }),
  },
  {
    pattern: /(?:don'?t|do not)\s+remember\s+(?:anything\s+)?about\s+(.+)/i,
    type: 'forget_topic',
    extractTarget: (match) => ({ target: match[1].trim() }),
  },

  // "Forget [specific thing]"
  {
    pattern: /forget\s+(?:that\s+)?(.+)/i,
    type: 'forget_specific',
    extractTarget: (match) => ({ target: match[1].trim() }),
  },

  // "Don't store this to notes" / "Don't save this conversation"
  {
    pattern:
      /(?:don'?t|do not)\s+(?:store|save|write)\s+(?:this|anything)\s+to\s+(?:notes?|vault|obsidian)/i,
    type: 'dont_store',
  },
  {
    pattern: /(?:off\s+the\s+record|this\s+is\s+private)/i,
    type: 'dont_store',
  },
];

/**
 * Phrases that indicate the user is NOT asking to forget
 * (to avoid false positives)
 */
const NEGATIVE_PATTERNS = [
  /how\s+(?:do\s+I|can\s+I|to)\s+(?:make\s+you\s+)?forget/i, // "How do I make you forget?"
  /can\s+you\s+forget/i, // "Can you forget things?"
  /(?:will|do)\s+you\s+(?:forget|remember)/i, // "Will you remember this?"
  /what\s+(?:do|can)\s+you\s+(?:forget|remember)/i, // "What can you forget?"
  /tell\s+me\s+about\s+forget/i, // "Tell me about forgetting"
  /\?\s*$/i, // Ends with question mark (might be asking, not commanding)
];

// ============================================================================
// Command Detection
// ============================================================================

/**
 * Detect if a user message contains a forget command
 */
export function detectForgetCommand(message: string): ForgetCommand | null {
  // Check for negative patterns first (questions about forgetting, not commands)
  for (const negPattern of NEGATIVE_PATTERNS) {
    if (negPattern.test(message)) {
      logger.debug('Message matches negative pattern, not a forget command', {
        message: message.slice(0, 50),
      });
      return null;
    }
  }

  // Try to match forget patterns
  for (const { pattern, type, extractTarget } of FORGET_PATTERNS) {
    const match = message.match(pattern);
    if (match) {
      const extracted = extractTarget ? extractTarget(match) : {};

      const command: ForgetCommand = {
        type,
        confidence: calculateConfidence(message, type),
        originalMessage: message,
        target: extracted.target,
        count: extracted.count,
      };

      logger.info('Forget command detected', {
        type,
        confidence: command.confidence.toFixed(2),
        target: command.target,
        count: command.count,
      });

      return command;
    }
  }

  return null;
}

/**
 * Calculate confidence score for a detected command
 */
function calculateConfidence(message: string, type: ForgetCommandType): number {
  let confidence = 0.7; // Base confidence

  // Boost for explicit keywords
  if (/\b(please|now|immediately)\b/i.test(message)) {
    confidence += 0.1;
  }

  // Boost for command-like structure (short, direct)
  if (message.length < 50) {
    confidence += 0.1;
  }

  // Reduce confidence for longer, more complex messages
  if (message.length > 100) {
    confidence -= 0.1;
  }

  // Boost for specific command types with clear intent
  if (type === 'forget_conversation' || type === 'forget_last') {
    confidence += 0.1;
  }

  return clamp01(confidence);
}

// ============================================================================
// Command Execution
// ============================================================================

/**
 * Execute a forget command
 */
export async function executeForgetCommand(command: ForgetCommand): Promise<ForgetResult> {
  logger.info('Executing forget command', {
    type: command.type,
    target: command.target,
    count: command.count,
  });

  try {
    switch (command.type) {
      case 'forget_conversation':
        return await forgetCurrentConversation();

      case 'forget_last':
        return await forgetLastExchanges(command.count || 1);

      case 'forget_specific':
        return await forgetSpecific(command.target || '');

      case 'forget_topic':
        return await forgetTopic(command.target || '');

      case 'dont_store':
        return await markDontStore();

      case 'forget_note':
        return await forgetNoteByName(command.target || '');

      case 'forget_time_range':
        return await forgetTimeRange(command.timeRange);

      default:
        return {
          success: false,
          commandType: command.type,
          response: "I'm not sure how to process that forget request.",
          itemsAffected: 0,
        };
    }
  } catch (error) {
    logger.error('Failed to execute forget command', {
      type: command.type,
      error: (error as Error).message,
    });

    return {
      success: false,
      commandType: command.type,
      response: `Sorry, I encountered an error while trying to forget: ${(error as Error).message}`,
      itemsAffected: 0,
    };
  }
}

/**
 * Forget the entire current conversation
 */
async function forgetCurrentConversation(): Promise<ForgetResult> {
  const conversationMemory = await getConversationMemory();
  const turnCount = conversationMemory.turnCount;

  await conversationMemory.forgetConversation();

  return {
    success: true,
    commandType: 'forget_conversation',
    response: `I've forgotten our current conversation. ${turnCount} exchange${turnCount !== 1 ? 's' : ''} removed and won't be stored.`,
    itemsAffected: turnCount,
    details: {
      turnsRemoved: turnCount,
    },
  };
}

/**
 * Forget the last N exchanges
 */
async function forgetLastExchanges(count: number): Promise<ForgetResult> {
  const conversationMemory = await getConversationMemory();
  const removed = conversationMemory.forgetLastTurns(count);

  if (removed === 0) {
    return {
      success: true,
      commandType: 'forget_last',
      response: "There's nothing to forget from our current conversation.",
      itemsAffected: 0,
    };
  }

  const exchangeWord = removed === 1 ? 'exchange' : 'exchanges';
  return {
    success: true,
    commandType: 'forget_last',
    response: `Done. I've forgotten the last ${removed} ${exchangeWord}.`,
    itemsAffected: removed,
    details: {
      turnsRemoved: removed,
    },
  };
}

/**
 * Forget something specific by content pattern
 */
async function forgetSpecific(target: string): Promise<ForgetResult> {
  if (!target || target.length < 3) {
    return {
      success: false,
      commandType: 'forget_specific',
      response: "Please specify what you'd like me to forget.",
      itemsAffected: 0,
    };
  }

  const forgettingManager = await getForgettingManager();
  const result = await forgettingManager.forget({
    contentPattern: target,
    reason: 'user_request',
  });

  if (result.deleted === 0 && result.protected === 0) {
    return {
      success: true,
      commandType: 'forget_specific',
      response: `I couldn't find any memories matching "${target}".`,
      itemsAffected: 0,
    };
  }

  if (result.protected > 0 && result.deleted === 0) {
    return {
      success: false,
      commandType: 'forget_specific',
      response: `Found ${result.protected} related memories, but they're protected. Say "force forget ${target}" to remove them anyway.`,
      itemsAffected: 0,
    };
  }

  return {
    success: true,
    commandType: 'forget_specific',
    response: `I've forgotten ${result.deleted} memor${result.deleted === 1 ? 'y' : 'ies'} about "${target}".`,
    itemsAffected: result.deleted,
    details: {
      memoriesRemoved: result.deleted,
    },
  };
}

/**
 * Forget everything about a topic
 */
async function forgetTopic(topic: string): Promise<ForgetResult> {
  if (!topic || topic.length < 2) {
    return {
      success: false,
      commandType: 'forget_topic',
      response: 'Please specify the topic you want me to forget.',
      itemsAffected: 0,
    };
  }

  const forgettingManager = await getForgettingManager();

  // Forget from memory manager
  const memoryResult = await forgettingManager.forget({
    contentPattern: topic,
    tags: [topic.toLowerCase()],
    reason: `topic_forget: ${topic}`,
  });

  // Also try to forget related notes
  let notesDeleted = 0;
  try {
    const noteResult = await forgetNotes({
      pattern: `*${topic}*`,
      limit: 50,
      reason: `topic_forget: ${topic}`,
    });
    notesDeleted = noteResult.deleted;
  } catch (error) {
    logger.warn('Failed to forget topic notes', {
      topic,
      error: (error as Error).message,
    });
  }

  const totalAffected = memoryResult.deleted + notesDeleted;

  if (totalAffected === 0) {
    return {
      success: true,
      commandType: 'forget_topic',
      response: `I don't seem to have any memories about "${topic}".`,
      itemsAffected: 0,
    };
  }

  return {
    success: true,
    commandType: 'forget_topic',
    response: `I've forgotten everything about "${topic}": ${memoryResult.deleted} memories and ${notesDeleted} notes removed.`,
    itemsAffected: totalAffected,
    details: {
      memoriesRemoved: memoryResult.deleted,
      notesRemoved: notesDeleted,
    },
  };
}

/**
 * Mark current conversation as "don't store"
 */
async function markDontStore(): Promise<ForgetResult> {
  const conversationMemory = await getConversationMemory();

  // Clear the conversation so it won't be stored
  await conversationMemory.forgetConversation();

  return {
    success: true,
    commandType: 'dont_store',
    response: "Understood. This conversation is off the record and won't be saved to my notes.",
    itemsAffected: 0,
  };
}

/**
 * Forget a note by name
 */
async function forgetNoteByName(noteName: string): Promise<ForgetResult> {
  if (!noteName) {
    return {
      success: false,
      commandType: 'forget_note',
      response: 'Please specify the note name you want me to forget.',
      itemsAffected: 0,
    };
  }

  // Try to find and delete the note
  const result = await forgetNotes({
    pattern: `*${noteName}*`,
    limit: 1,
    reason: 'user_request',
  });

  if (result.deleted === 0) {
    return {
      success: false,
      commandType: 'forget_note',
      response: `I couldn't find a note matching "${noteName}".`,
      itemsAffected: 0,
    };
  }

  return {
    success: true,
    commandType: 'forget_note',
    response: `I've deleted the note "${result.paths[0]}".`,
    itemsAffected: 1,
    details: {
      notesRemoved: 1,
    },
  };
}

/**
 * Forget memories from a time range
 */
async function forgetTimeRange(timeRange?: { start: Date; end: Date }): Promise<ForgetResult> {
  if (!timeRange) {
    return {
      success: false,
      commandType: 'forget_time_range',
      response: 'Please specify the time range you want me to forget.',
      itemsAffected: 0,
    };
  }

  const forgettingManager = await getForgettingManager();
  const result = await forgettingManager.forget({
    dateRange: {
      start: timeRange.start.getTime(),
      end: timeRange.end.getTime(),
    },
    reason: 'time_range_forget',
  });

  return {
    success: true,
    commandType: 'forget_time_range',
    response: `I've forgotten ${result.deleted} memories from that time period.`,
    itemsAffected: result.deleted,
    details: {
      memoriesRemoved: result.deleted,
    },
  };
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Check if a message is a forget command and execute it if so
 * Returns null if the message is not a forget command
 */
export async function handleForgetCommand(message: string): Promise<ForgetResult | null> {
  const command = detectForgetCommand(message);

  if (!command) {
    return null;
  }

  // Require higher confidence for automatic execution
  if (command.confidence < 0.6) {
    logger.debug('Forget command detected but confidence too low', {
      confidence: command.confidence,
    });
    return null;
  }

  return executeForgetCommand(command);
}

/**
 * Get a user-friendly description of forget capabilities
 */
export function getForgetCapabilities(): string {
  return `You can ask me to forget things in several ways:
- "Don't remember this" - I'll forget our last exchange
- "Forget this conversation" - I'll forget our entire current chat
- "Forget the last 3 messages" - I'll forget recent exchanges
- "Forget everything about [topic]" - I'll remove all memories about a topic
- "Off the record" - I won't save this conversation to my notes

Your privacy is important to me.`;
}

export default {
  detectForgetCommand,
  executeForgetCommand,
  handleForgetCommand,
  getForgetCapabilities,
};
