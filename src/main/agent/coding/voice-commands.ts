/**
 * @file Voice Commands for the Coding Agent
 * @description Natural language to coding actions - intent parsing and task decomposition
 */

import { createModuleLogger } from '../../utils/logger';
import { getErrorMessage } from '../../../shared/utils';
import type {
  VoiceCommand,
  CodingIntent,
  CommandEntities,
} from './types';

const logger = createModuleLogger('VoiceCommands');

/**
 * Intent patterns for voice command recognition
 * Each pattern maps to a coding intent with associated regex and keywords
 */
const INTENT_PATTERNS: {
  intent: CodingIntent;
  patterns: RegExp[];
  keywords: string[];
}[] = [
  // Create file
  {
    intent: 'create-file',
    patterns: [
      /create\s+(?:a\s+)?(?:new\s+)?file\s+(?:called\s+)?(.+)/i,
      /make\s+(?:a\s+)?(?:new\s+)?file\s+(?:called\s+)?(.+)/i,
      /add\s+(?:a\s+)?(?:new\s+)?file\s+(?:called\s+)?(.+)/i,
      /new\s+file\s+(.+)/i,
    ],
    keywords: ['create', 'new file', 'make file', 'add file'],
  },
  // Edit file
  {
    intent: 'edit-file',
    patterns: [
      /edit\s+(?:the\s+)?(?:file\s+)?(.+)/i,
      /modify\s+(?:the\s+)?(?:file\s+)?(.+)/i,
      /update\s+(?:the\s+)?(?:file\s+)?(.+)/i,
      /change\s+(?:the\s+)?(.+?)\s+(?:file|code)/i,
      /in\s+(.+?)\s+(?:change|update|modify)/i,
    ],
    keywords: ['edit', 'modify', 'update', 'change'],
  },
  // Delete file
  {
    intent: 'delete-file',
    patterns: [
      /delete\s+(?:the\s+)?(?:file\s+)?(.+)/i,
      /remove\s+(?:the\s+)?(?:file\s+)?(.+)/i,
      /get\s+rid\s+of\s+(.+)/i,
    ],
    keywords: ['delete', 'remove', 'get rid of'],
  },
  // Rename file
  {
    intent: 'rename-file',
    patterns: [
      /rename\s+(.+?)\s+to\s+(.+)/i,
      /move\s+(.+?)\s+to\s+(.+)/i,
      /change\s+(?:the\s+)?name\s+of\s+(.+?)\s+to\s+(.+)/i,
    ],
    keywords: ['rename', 'move'],
  },
  // Search code
  {
    intent: 'search-code',
    patterns: [
      /search\s+(?:for\s+)?(.+)/i,
      /find\s+(?:all\s+)?(?:occurrences\s+of\s+)?(.+)/i,
      /look\s+for\s+(.+)/i,
      /where\s+(?:is|are)\s+(.+)/i,
      /grep\s+(?:for\s+)?(.+)/i,
    ],
    keywords: ['search', 'find', 'look for', 'where is', 'grep'],
  },
  // Find symbol
  {
    intent: 'find-symbol',
    patterns: [
      /find\s+(?:the\s+)?(?:function|class|method|variable|type|interface)\s+(.+)/i,
      /go\s+to\s+(?:definition\s+of\s+)?(.+)/i,
      /show\s+(?:me\s+)?(?:the\s+)?definition\s+of\s+(.+)/i,
      /where\s+is\s+(.+?)\s+defined/i,
    ],
    keywords: ['find function', 'find class', 'go to', 'definition'],
  },
  // Fix errors
  {
    intent: 'fix-errors',
    patterns: [
      /fix\s+(?:the\s+)?(?:typescript\s+)?error/i,
      /fix\s+(?:the\s+)?(?:type\s+)?errors?/i,
      /resolve\s+(?:the\s+)?(?:build\s+)?errors?/i,
      /fix\s+(?:the\s+)?(?:compilation\s+)?errors?/i,
      /make\s+it\s+compile/i,
      /fix\s+(?:the\s+)?types?/i,
    ],
    keywords: ['fix error', 'fix type', 'resolve error', 'make compile'],
  },
  // Run command
  {
    intent: 'run-command',
    patterns: [
      /run\s+(.+)/i,
      /execute\s+(.+)/i,
      /npm\s+(.+)/i,
      /yarn\s+(.+)/i,
      /pnpm\s+(.+)/i,
    ],
    keywords: ['run', 'execute', 'npm', 'yarn', 'pnpm'],
  },
  // Run tests
  {
    intent: 'run-tests',
    patterns: [
      /run\s+(?:the\s+)?tests?/i,
      /test\s+(?:the\s+)?(?:code|project)/i,
      /run\s+(?:the\s+)?test\s+suite/i,
      /npm\s+test/i,
    ],
    keywords: ['run test', 'test code', 'test suite'],
  },
  // Explain code
  {
    intent: 'explain-code',
    patterns: [
      /explain\s+(?:this\s+)?(?:code|function|class)/i,
      /what\s+does\s+(?:this\s+)?(.+?)\s+do/i,
      /how\s+does\s+(?:this\s+)?(.+?)\s+work/i,
      /tell\s+me\s+about\s+(.+)/i,
    ],
    keywords: ['explain', 'what does', 'how does', 'tell me about'],
  },
  // Refactor
  {
    intent: 'refactor',
    patterns: [
      /refactor\s+(.+)/i,
      /clean\s+up\s+(.+)/i,
      /improve\s+(.+)/i,
      /simplify\s+(.+)/i,
      /optimize\s+(.+)/i,
      /extract\s+(.+?)\s+(?:to|into)/i,
    ],
    keywords: ['refactor', 'clean up', 'improve', 'simplify', 'optimize', 'extract'],
  },
  // Add feature
  {
    intent: 'add-feature',
    patterns: [
      /add\s+(?:a\s+)?(?:new\s+)?(.+)/i,
      /implement\s+(.+)/i,
      /create\s+(?:a\s+)?(?:new\s+)?(.+)/i,
      /build\s+(?:a\s+)?(.+)/i,
      /write\s+(?:a\s+)?(?:code\s+(?:for|to)\s+)?(.+)/i,
    ],
    keywords: ['add', 'implement', 'create', 'build', 'write'],
  },
  // Debug
  {
    intent: 'debug',
    patterns: [
      /debug\s+(.+)/i,
      /fix\s+(?:the\s+)?bug\s+(?:in\s+)?(.+)/i,
      /why\s+(?:is|isn't)\s+(.+?)\s+(?:working|broken)/i,
      /figure\s+out\s+why\s+(.+)/i,
    ],
    keywords: ['debug', 'fix bug', 'why is', 'why isn\'t'],
  },
  // Commit
  {
    intent: 'commit',
    patterns: [
      /commit\s+(?:the\s+)?(?:changes?)?(?:\s+with\s+message\s+)?(.+)?/i,
      /git\s+commit/i,
      /save\s+(?:my\s+)?changes?\s+(?:to\s+git)?/i,
      /stage\s+(?:and\s+)?commit/i,
    ],
    keywords: ['commit', 'git commit', 'save changes'],
  },
];

/**
 * Entity extraction patterns
 */
const ENTITY_PATTERNS = {
  // File paths
  files: [
    /['"]([^'"]+\.[a-z]{2,4})['"]/gi,           // Quoted file names
    /(\w+(?:\/\w+)*\.[a-z]{2,4})\b/gi,          // path/to/file.ext
    /(src\/[^\s]+)/gi,                           // src/...
    /(\.\.\?\/[^\s]+)/gi,                        // ./... or ../...
  ],
  // Symbol names (functions, classes, etc.)
  symbols: [
    /(?:function|class|method|variable|type|interface)\s+['"]?(\w+)['"]?/gi,
    /['"](\w+)['"]\s+(?:function|class|method)/gi,
    /\b([A-Z][a-zA-Z0-9]+)\b/g,                 // PascalCase (classes, types)
    /\b([a-z][a-zA-Z0-9]+)\s*\(/g,              // camelCase followed by ( (functions)
  ],
  // Search queries
  queries: [
    /search\s+(?:for\s+)?['"]([^'"]+)['"]/gi,
    /find\s+['"]([^'"]+)['"]/gi,
    /grep\s+['"]([^'"]+)['"]/gi,
  ],
  // Commands
  commands: [
    /run\s+['"]?([^'"]+)['"]?/gi,
    /execute\s+['"]?([^'"]+)['"]?/gi,
    /\$\s*(.+)/gi,
  ],
  // Languages/frameworks
  languages: [
    /\b(typescript|javascript|python|rust|go|java|react|vue|angular|node|express|next\.?js)\b/gi,
  ],
  // Quoted strings
  quotedStrings: [
    /['"]([^'"]+)['"]/g,
  ],
  // Numbers
  numbers: [
    /\b(\d+)\b/g,
    /line\s+(\d+)/gi,
    /lines?\s+(\d+)(?:\s*[-–]\s*(\d+))?/gi,
  ],
};

/**
 * Parse a voice command into structured intent and entities
 */
export function parseVoiceCommand(text: string): VoiceCommand {
  logger.debug('Parsing voice command', { text });

  // Normalize the text
  const normalized = text.toLowerCase().trim();

  // Find the best matching intent
  let bestMatch: { intent: CodingIntent; confidence: number; match?: RegExpMatchArray } = {
    intent: 'unknown',
    confidence: 0,
  };

  for (const { intent, patterns, keywords } of INTENT_PATTERNS) {
    // Check patterns
    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match) {
        const confidence = 0.9; // High confidence for pattern match
        if (confidence > bestMatch.confidence) {
          bestMatch = { intent, confidence, match };
        }
      }
    }

    // Check keywords (lower confidence)
    for (const keyword of keywords) {
      if (normalized.includes(keyword)) {
        const confidence = 0.6; // Lower confidence for keyword match
        if (confidence > bestMatch.confidence) {
          bestMatch = { intent, confidence };
        }
      }
    }
  }

  // Extract entities
  const entities = extractEntities(text);

  // Generate clarifications if confidence is low
  let clarifications: string[] | undefined;
  if (bestMatch.confidence < 0.7) {
    clarifications = generateClarifications(bestMatch.intent, entities);
  }

  logger.debug('Voice command parsed', {
    intent: bestMatch.intent,
    confidence: bestMatch.confidence,
    entities,
  });

  return {
    raw: text,
    intent: bestMatch.intent,
    confidence: bestMatch.confidence,
    entities,
    clarifications,
  };
}

/**
 * Extract entities from text
 */
function extractEntities(text: string): CommandEntities {
  const entities: CommandEntities = {};

  // Extract file paths
  const files = new Set<string>();
  for (const pattern of ENTITY_PATTERNS.files) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      files.add(match[1]);
    }
  }
  if (files.size > 0) {
    entities.files = Array.from(files);
  }

  // Extract symbol names
  const symbols = new Set<string>();
  for (const pattern of ENTITY_PATTERNS.symbols) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      symbols.add(match[1]);
    }
  }
  if (symbols.size > 0) {
    entities.symbols = Array.from(symbols);
  }

  // Extract queries
  const queries = new Set<string>();
  for (const pattern of ENTITY_PATTERNS.queries) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      queries.add(match[1]);
    }
  }
  if (queries.size > 0) {
    entities.queries = Array.from(queries);
  }

  // Extract commands
  const commands: string[] = [];
  for (const pattern of ENTITY_PATTERNS.commands) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      commands.push(match[1]);
    }
  }
  if (commands.length > 0) {
    entities.commands = commands;
  }

  // Extract languages
  const languages = new Set<string>();
  for (const pattern of ENTITY_PATTERNS.languages) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      languages.add(match[1].toLowerCase());
    }
  }
  if (languages.size > 0) {
    entities.languages = Array.from(languages);
  }

  // Extract quoted strings
  const quotedStrings = new Set<string>();
  for (const pattern of ENTITY_PATTERNS.quotedStrings) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      quotedStrings.add(match[1]);
    }
  }
  if (quotedStrings.size > 0) {
    entities.quotedStrings = Array.from(quotedStrings);
  }

  // Extract numbers
  const numbers = new Set<number>();
  for (const pattern of ENTITY_PATTERNS.numbers) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      numbers.add(parseInt(match[1], 10));
      if (match[2]) {
        numbers.add(parseInt(match[2], 10));
      }
    }
  }
  if (numbers.size > 0) {
    entities.numbers = Array.from(numbers);
  }

  return entities;
}

/**
 * Generate clarification questions for ambiguous commands
 */
function generateClarifications(intent: CodingIntent, entities: CommandEntities): string[] {
  const clarifications: string[] = [];

  switch (intent) {
    case 'create-file':
      if (!entities.files || entities.files.length === 0) {
        clarifications.push('What should the file be named?');
      }
      break;

    case 'edit-file':
      if (!entities.files || entities.files.length === 0) {
        clarifications.push('Which file would you like to edit?');
      }
      break;

    case 'search-code':
      if (!entities.queries || entities.queries.length === 0) {
        clarifications.push('What would you like to search for?');
      }
      break;

    case 'find-symbol':
      if (!entities.symbols || entities.symbols.length === 0) {
        clarifications.push('What symbol are you looking for?');
      }
      break;

    case 'run-command':
      if (!entities.commands || entities.commands.length === 0) {
        clarifications.push('What command would you like to run?');
      }
      break;

    case 'unknown':
      clarifications.push('I\'m not sure what you want to do. Could you be more specific?');
      clarifications.push('Try saying things like "create a new file", "fix the errors", or "search for..."');
      break;
  }

  return clarifications;
}

/**
 * Convert a voice command to a coding agent prompt
 */
export function commandToPrompt(command: VoiceCommand): string {
  const { intent, entities } = command;

  switch (intent) {
    case 'create-file':
      const fileName = entities.files?.[0] || entities.quotedStrings?.[0] || 'new file';
      return `Create a new file named "${fileName}". If I didn't specify what should be in it, create an appropriate template based on the file extension.`;

    case 'edit-file':
      const editFile = entities.files?.[0] || '';
      return editFile
        ? `Edit the file "${editFile}". ${command.raw}`
        : command.raw;

    case 'delete-file':
      const deleteFile = entities.files?.[0] || '';
      return deleteFile
        ? `Delete the file "${deleteFile}".`
        : `Delete the file mentioned: ${command.raw}`;

    case 'rename-file':
      return command.raw;

    case 'search-code':
      const searchQuery = entities.queries?.[0] || entities.quotedStrings?.[0] || '';
      return searchQuery
        ? `Search the codebase for "${searchQuery}".`
        : `Search the codebase: ${command.raw}`;

    case 'find-symbol':
      const symbol = entities.symbols?.[0] || '';
      return symbol
        ? `Find the definition and usages of "${symbol}".`
        : `Find the symbol: ${command.raw}`;

    case 'fix-errors':
      return `Check for TypeScript/compilation errors and fix them. Run the type checker, identify all errors, and make the necessary code changes to resolve them.`;

    case 'run-command':
      const cmdToRun = entities.commands?.[0] || '';
      return cmdToRun
        ? `Run the command: ${cmdToRun}`
        : `Run the command: ${command.raw}`;

    case 'run-tests':
      return `Run the test suite and report the results. If there are failures, show me which tests failed and why.`;

    case 'explain-code':
      const explainFile = entities.files?.[0] || '';
      return explainFile
        ? `Explain the code in "${explainFile}". What does it do and how does it work?`
        : `Explain this code: ${command.raw}`;

    case 'refactor':
      return `Refactor the code: ${command.raw}. Improve readability, reduce complexity, and follow best practices.`;

    case 'add-feature':
      return command.raw;

    case 'debug':
      return `Debug the issue: ${command.raw}. Investigate the code, identify the root cause, and suggest or implement a fix.`;

    case 'commit':
      return `Stage all changes and create a git commit with an appropriate message based on the changes made.`;

    case 'unknown':
    default:
      return command.raw;
  }
}

/**
 * Quick command shortcuts for common operations
 */
export const QUICK_COMMANDS: { phrase: string; prompt: string }[] = [
  { phrase: 'fix errors', prompt: 'Check for and fix all TypeScript errors in the project.' },
  { phrase: 'run tests', prompt: 'Run the test suite and report results.' },
  { phrase: 'build', prompt: 'Build the project and report any errors.' },
  { phrase: 'lint', prompt: 'Run the linter and fix any issues.' },
  { phrase: 'format', prompt: 'Format all code files using the project\'s formatter.' },
  { phrase: 'status', prompt: 'Show the current git status and any pending changes.' },
  { phrase: 'diff', prompt: 'Show the git diff of current changes.' },
  { phrase: 'commit', prompt: 'Stage all changes and commit with an appropriate message.' },
  { phrase: 'push', prompt: 'Push the current branch to the remote repository.' },
  { phrase: 'pull', prompt: 'Pull the latest changes from the remote repository.' },
];

/**
 * Check if text matches a quick command
 */
export function matchQuickCommand(text: string): string | null {
  const normalized = text.toLowerCase().trim();

  for (const { phrase, prompt } of QUICK_COMMANDS) {
    if (normalized === phrase || normalized === `atlas ${phrase}`) {
      return prompt;
    }
  }

  return null;
}

/**
 * Voice command handler that integrates with the coding agent
 */
export class VoiceCommandHandler {
  private lastCommand: VoiceCommand | null = null;

  /**
   * Process a voice transcription
   */
  processTranscription(text: string): { prompt: string; command: VoiceCommand } | null {
    // Skip empty or very short transcriptions
    if (!text || text.trim().length < 3) {
      return null;
    }

    // Check for quick commands first
    const quickPrompt = matchQuickCommand(text);
    if (quickPrompt) {
      const command: VoiceCommand = {
        raw: text,
        intent: 'run-command',
        confidence: 1.0,
        entities: {},
      };
      this.lastCommand = command;
      return { prompt: quickPrompt, command };
    }

    // Parse the voice command
    const command = parseVoiceCommand(text);
    this.lastCommand = command;

    // If we couldn't determine intent, check if it's conversational
    if (command.intent === 'unknown' && command.confidence < 0.3) {
      // Treat as a general request to the coding agent
      return { prompt: text, command };
    }

    // Convert to prompt
    const prompt = commandToPrompt(command);
    return { prompt, command };
  }

  /**
   * Get the last processed command
   */
  getLastCommand(): VoiceCommand | null {
    return this.lastCommand;
  }
}

// Singleton instance
let voiceCommandHandler: VoiceCommandHandler | null = null;

/**
 * Get the voice command handler instance
 */
export function getVoiceCommandHandler(): VoiceCommandHandler {
  if (!voiceCommandHandler) {
    voiceCommandHandler = new VoiceCommandHandler();
  }
  return voiceCommandHandler;
}

export default VoiceCommandHandler;
