/**
 * Atlas Desktop - Code Opinion Engine
 *
 * Provides confident, opinionated code review suggestions.
 * Atlas doesn't just suggest - it states preferences with conviction.
 *
 * These opinions are informed by:
 * 1. Industry best practices
 * 2. User's learned preferences (from corrections and explicit statements)
 * 3. Project context
 *
 * @module agent/code-opinions
 */

import { createModuleLogger } from '../utils/logger';
import { getUserProfileManager, UserProfileManager, CodingPreference } from '../memory/user-profile';

const logger = createModuleLogger('CodeOpinions');

// ============================================================================
// Types
// ============================================================================

export interface CodeOpinion {
  /** What the opinion is about */
  topic: string;
  /** The opinionated stance */
  opinion: string;
  /** Why this is preferred */
  rationale: string;
  /** How confident Atlas should be (1-10) */
  confidence: number;
  /** Category for organization */
  category: OpinionCategory;
  /** Example of good code */
  goodExample?: string;
  /** Example of what to avoid */
  badExample?: string;
  /** Keywords that trigger this opinion */
  triggers?: string[];
}

export type OpinionCategory =
  | 'typescript'
  | 'react'
  | 'state-management'
  | 'testing'
  | 'architecture'
  | 'naming'
  | 'performance'
  | 'security'
  | 'style'
  | 'tooling'
  | 'general';

export interface OpinionContext {
  /** Current file language */
  language?: string;
  /** Current framework (react, vue, etc) */
  framework?: string;
  /** Code snippet being discussed */
  codeSnippet?: string;
  /** What the user is working on */
  task?: string;
}

// ============================================================================
// Default Opinions - Atlas's Built-in Preferences
// ============================================================================

const DEFAULT_OPINIONS: CodeOpinion[] = [
  // TypeScript
  {
    topic: 'Type Safety',
    opinion: "Use strict TypeScript. No 'any' unless you have a very good reason.",
    rationale:
      "Type safety catches bugs at compile time. 'any' defeats the entire purpose of TypeScript.",
    confidence: 9,
    category: 'typescript',
    badExample: "const data: any = response.data;",
    goodExample: "const data: UserResponse = response.data;",
    triggers: ['any', 'type', 'typescript', 'ts'],
  },
  {
    topic: 'Interface vs Type',
    opinion: 'Use interfaces for object shapes, types for unions and primitives.',
    rationale:
      'Interfaces are extendable and give better error messages. Types are more flexible for complex compositions.',
    confidence: 7,
    category: 'typescript',
    triggers: ['interface', 'type', 'define'],
  },
  {
    topic: 'Enums',
    opinion: 'Prefer const objects or union types over enums.',
    rationale:
      'Enums have runtime overhead and can be confusing. Union types are more idiomatic TypeScript.',
    confidence: 8,
    category: 'typescript',
    badExample: "enum Status { Active, Inactive }",
    goodExample: "const STATUS = { Active: 'active', Inactive: 'inactive' } as const;",
    triggers: ['enum', 'status', 'constant'],
  },

  // State Management
  {
    topic: 'Global State',
    opinion: "Don't reach for global state until local state hurts. Start simple.",
    rationale:
      'Most state is local. Adding Redux or Zustand for everything creates unnecessary complexity.',
    confidence: 9,
    category: 'state-management',
    triggers: ['state', 'redux', 'zustand', 'context', 'global'],
  },
  {
    topic: 'useState vs useReducer',
    opinion: 'useReducer when state transitions are complex. useState for everything else.',
    rationale:
      'useReducer shines when you have related state updates. useState is simpler for independent values.',
    confidence: 8,
    category: 'state-management',
    triggers: ['usestate', 'usereducer', 'state', 'hook'],
  },
  {
    topic: 'Server State',
    opinion: 'Use React Query or SWR for server state. Stop putting API responses in Redux.',
    rationale:
      'Server state has different concerns (caching, revalidation, mutations). Dedicated tools handle this better.',
    confidence: 9,
    category: 'state-management',
    triggers: ['api', 'fetch', 'server', 'cache', 'query'],
  },

  // React
  {
    topic: 'Component Size',
    opinion:
      'If a component is over 150 lines, split it. If you need to scroll to understand it, it\'s too big.',
    rationale: 'Smaller components are easier to test, reason about, and reuse.',
    confidence: 8,
    category: 'react',
    triggers: ['component', 'split', 'refactor', 'large'],
  },
  {
    topic: 'useEffect',
    opinion:
      'useEffect is usually wrong. Ask yourself: is this really a side effect, or should it be derived state?',
    rationale:
      'Most useEffect calls can be replaced with derived values, event handlers, or custom hooks.',
    confidence: 9,
    category: 'react',
    triggers: ['useeffect', 'effect', 'side effect', 'lifecycle'],
  },
  {
    topic: 'Prop Drilling',
    opinion:
      'Prop drilling is fine for 2-3 levels. Beyond that, use composition or context.',
    rationale:
      "Don't reach for Context immediately. Sometimes the answer is better component composition.",
    confidence: 7,
    category: 'react',
    triggers: ['props', 'drilling', 'context', 'pass'],
  },

  // Testing
  {
    topic: 'Test Coverage',
    opinion: "Test behavior, not implementation. If your tests break when you refactor, they're bad tests.",
    rationale: 'Tests should verify what the code does, not how it does it.',
    confidence: 9,
    category: 'testing',
    triggers: ['test', 'coverage', 'unit', 'mock'],
  },
  {
    topic: 'Mocking',
    opinion: "Mock at the boundaries (network, file system). Don't mock everything.",
    rationale: 'Over-mocking makes tests brittle and gives false confidence.',
    confidence: 8,
    category: 'testing',
    triggers: ['mock', 'stub', 'fake', 'spy'],
  },
  {
    topic: 'Integration Tests',
    opinion:
      'Write more integration tests, fewer unit tests. Test the thing users actually use.',
    rationale:
      'Integration tests catch more real bugs. A passing unit test suite with failing integration tests is worthless.',
    confidence: 8,
    category: 'testing',
    triggers: ['integration', 'e2e', 'unit test', 'testing strategy'],
  },

  // Architecture
  {
    topic: 'Early Abstraction',
    opinion: "Don't abstract until you've seen the pattern three times. Premature abstraction is worse than duplication.",
    rationale:
      'Wrong abstractions are harder to change than duplicated code. Wait until the pattern is clear.',
    confidence: 9,
    category: 'architecture',
    triggers: ['abstract', 'dry', 'duplicate', 'refactor', 'pattern'],
  },
  {
    topic: 'File Organization',
    opinion: 'Colocate related files. Tests next to source. Styles next to components.',
    rationale: 'Hunting through folder hierarchies wastes time. Keep related things together.',
    confidence: 8,
    category: 'architecture',
    triggers: ['folder', 'structure', 'organize', 'file', 'directory'],
  },
  {
    topic: 'Dependencies',
    opinion: 'Every dependency is a liability. Add them thoughtfully, remove them aggressively.',
    rationale:
      'Dependencies break, get abandoned, have security issues. Built-in solutions are often enough.',
    confidence: 9,
    category: 'architecture',
    triggers: ['dependency', 'package', 'npm', 'library', 'install'],
  },

  // Naming
  {
    topic: 'Variable Names',
    opinion: 'Be specific. `data`, `info`, `item`, `result` are almost always wrong.',
    rationale: 'Good names make code self-documenting. Bad names require comments.',
    confidence: 9,
    category: 'naming',
    badExample: 'const data = await fetch(...);',
    goodExample: 'const userProfile = await fetch(...);',
    triggers: ['name', 'variable', 'naming', 'rename'],
  },
  {
    topic: 'Boolean Names',
    opinion: "Booleans should read like questions: `isLoading`, `hasPermission`, `canEdit`.",
    rationale: 'Boolean names should be obviously true/false. `loading` is ambiguous.',
    confidence: 8,
    category: 'naming',
    badExample: 'const loading = true;',
    goodExample: 'const isLoading = true;',
    triggers: ['boolean', 'flag', 'is', 'has', 'can'],
  },
  {
    topic: 'Function Names',
    opinion: 'Functions do things - use verbs. `getUser`, `validateInput`, `handleSubmit`.',
    rationale: 'Verb names make it clear the function performs an action.',
    confidence: 8,
    category: 'naming',
    triggers: ['function', 'method', 'name'],
  },

  // Performance
  {
    topic: 'Premature Optimization',
    opinion: "Don't optimize until you've measured. Profile first, optimize second.",
    rationale: 'Guessing about performance is almost always wrong. Data beats intuition.',
    confidence: 9,
    category: 'performance',
    triggers: ['optimize', 'performance', 'slow', 'fast', 'cache'],
  },
  {
    topic: 'useMemo/useCallback',
    opinion:
      "useMemo and useCallback are often unnecessary. Only use them when you've proven a performance issue.",
    rationale: 'Memoization has overhead. React is fast. Measure before optimizing.',
    confidence: 8,
    category: 'performance',
    triggers: ['usememo', 'usecallback', 'memo', 'memoize'],
  },

  // Security
  {
    topic: 'User Input',
    opinion: 'Never trust user input. Validate and sanitize everything.',
    rationale:
      'Every input is a potential attack vector. Assume malicious intent.',
    confidence: 10,
    category: 'security',
    triggers: ['input', 'user', 'form', 'validate', 'sanitize'],
  },
  {
    topic: 'Secrets',
    opinion: 'Secrets never go in code. Environment variables minimum, secret manager preferred.',
    rationale: 'Secrets in code end up in version control. This is always a breach waiting to happen.',
    confidence: 10,
    category: 'security',
    triggers: ['secret', 'api key', 'password', 'credential', 'env'],
  },

  // Style
  {
    topic: 'Comments',
    opinion:
      "Don't comment what, comment why. If you need to explain what code does, the code is unclear.",
    rationale: 'Good code is self-documenting. Comments explain the reasoning, not the mechanics.',
    confidence: 9,
    category: 'style',
    triggers: ['comment', 'document', 'explain'],
  },
  {
    topic: 'Error Handling',
    opinion:
      'Handle errors explicitly. No empty catch blocks. If you catch it, do something with it.',
    rationale: 'Silent failures are debugging nightmares. Errors should be visible and handled.',
    confidence: 9,
    category: 'style',
    badExample: 'try { ... } catch (e) { }',
    goodExample: 'try { ... } catch (e) { logger.error("Failed to X", e); throw e; }',
    triggers: ['error', 'catch', 'try', 'exception', 'throw'],
  },
];

// ============================================================================
// Code Opinion Engine
// ============================================================================

export class CodeOpinionEngine {
  private opinions: CodeOpinion[] = [...DEFAULT_OPINIONS];
  private userProfileManager: UserProfileManager | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.userProfileManager = await getUserProfileManager();
      await this.loadUserPreferences();
      this.initialized = true;
      logger.info('Code Opinion Engine initialized', {
        defaultOpinions: DEFAULT_OPINIONS.length,
        totalOpinions: this.opinions.length,
      });
    } catch (error) {
      logger.error('Failed to initialize Code Opinion Engine', {
        error: (error as Error).message,
      });
      // Still mark as initialized - we can work without user preferences
      this.initialized = true;
    }
  }

  /**
   * Load user's coding preferences and merge with defaults
   */
  private async loadUserPreferences(): Promise<void> {
    if (!this.userProfileManager) return;

    const userPrefs = this.userProfileManager.getCodingPreferences();

    for (const pref of userPrefs) {
      // Check if this overrides a default opinion
      const existingIndex = this.opinions.findIndex(
        (o) => o.topic.toLowerCase() === pref.topic.toLowerCase()
      );

      const userOpinion: CodeOpinion = {
        topic: pref.topic,
        opinion: pref.preference,
        rationale: pref.reason || "Based on your stated preference",
        confidence: pref.strength,
        category: this.inferCategory(pref.topic),
        triggers: [pref.topic.toLowerCase()],
      };

      if (existingIndex >= 0) {
        // User preference overrides default
        this.opinions[existingIndex] = userOpinion;
        logger.debug('User preference overrode default', { topic: pref.topic });
      } else {
        // Add new user preference
        this.opinions.push(userOpinion);
      }
    }
  }

  /**
   * Infer category from topic name
   */
  private inferCategory(topic: string): OpinionCategory {
    const lower = topic.toLowerCase();

    if (lower.includes('type') || lower.includes('interface') || lower.includes('enum')) {
      return 'typescript';
    }
    if (lower.includes('react') || lower.includes('component') || lower.includes('hook')) {
      return 'react';
    }
    if (lower.includes('state') || lower.includes('redux') || lower.includes('zustand')) {
      return 'state-management';
    }
    if (lower.includes('test') || lower.includes('mock') || lower.includes('coverage')) {
      return 'testing';
    }
    if (lower.includes('name') || lower.includes('variable')) {
      return 'naming';
    }
    if (lower.includes('perform') || lower.includes('optim') || lower.includes('cache')) {
      return 'performance';
    }
    if (lower.includes('secur') || lower.includes('input') || lower.includes('valid')) {
      return 'security';
    }

    return 'general';
  }

  /**
   * Get relevant opinions for a given context
   */
  getRelevantOpinions(context: OpinionContext): CodeOpinion[] {
    const relevant: CodeOpinion[] = [];
    const contextText = [
      context.language,
      context.framework,
      context.codeSnippet,
      context.task,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    for (const opinion of this.opinions) {
      // Check if any triggers match
      const triggers = opinion.triggers || [opinion.topic.toLowerCase()];
      const matches = triggers.some((trigger) => contextText.includes(trigger.toLowerCase()));

      if (matches) {
        relevant.push(opinion);
      }
    }

    // Sort by confidence
    return relevant.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get a single strong opinion on a topic
   */
  getOpinion(topic: string): CodeOpinion | undefined {
    return this.opinions.find(
      (o) =>
        o.topic.toLowerCase().includes(topic.toLowerCase()) ||
        (o.triggers && o.triggers.some((t) => t.toLowerCase().includes(topic.toLowerCase())))
    );
  }

  /**
   * Get all opinions in a category
   */
  getOpinionsByCategory(category: OpinionCategory): CodeOpinion[] {
    return this.opinions.filter((o) => o.category === category);
  }

  /**
   * Format an opinion for voice response
   * Makes it confident and conversational
   */
  formatForVoice(opinion: CodeOpinion): string {
    const confidencePrefix =
      opinion.confidence >= 9
        ? "I'm quite opinionated about this: "
        : opinion.confidence >= 7
          ? 'I strongly suggest: '
          : 'In my experience: ';

    return `${confidencePrefix}${opinion.opinion} ${opinion.rationale}`;
  }

  /**
   * Format an opinion for text response with examples
   */
  formatForText(opinion: CodeOpinion): string {
    let response = `**${opinion.topic}**\n\n${opinion.opinion}\n\n*${opinion.rationale}*`;

    if (opinion.badExample) {
      response += `\n\n❌ Avoid:\n\`\`\`\n${opinion.badExample}\n\`\`\``;
    }

    if (opinion.goodExample) {
      response += `\n\n✅ Prefer:\n\`\`\`\n${opinion.goodExample}\n\`\`\``;
    }

    return response;
  }

  /**
   * Build system prompt addition with user's coding preferences
   */
  buildSystemPromptAddition(): string {
    const strongOpinions = this.opinions
      .filter((o) => o.confidence >= 8)
      .slice(0, 10);

    if (strongOpinions.length === 0) return '';

    const opinions = strongOpinions
      .map((o) => `- ${o.topic}: ${o.opinion}`)
      .join('\n');

    return `
You have strong opinions about code. Express these confidently when relevant:
${opinions}

When reviewing code or giving suggestions, don't be wishy-washy. State your preference clearly.
If the user's code violates these preferences, point it out directly but constructively.
`;
  }

  /**
   * Add a new opinion (from user feedback or learning)
   */
  addOpinion(opinion: CodeOpinion): void {
    const existingIndex = this.opinions.findIndex(
      (o) => o.topic.toLowerCase() === opinion.topic.toLowerCase()
    );

    if (existingIndex >= 0) {
      this.opinions[existingIndex] = opinion;
    } else {
      this.opinions.push(opinion);
    }

    logger.info('Opinion added/updated', { topic: opinion.topic });
  }

  /**
   * Get all opinions
   */
  getAllOpinions(): CodeOpinion[] {
    return [...this.opinions];
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let codeOpinionEngine: CodeOpinionEngine | null = null;

/**
 * Get the code opinion engine instance
 */
export async function getCodeOpinionEngine(): Promise<CodeOpinionEngine> {
  if (!codeOpinionEngine) {
    codeOpinionEngine = new CodeOpinionEngine();
    await codeOpinionEngine.initialize();
  }
  return codeOpinionEngine;
}

/**
 * Shutdown the code opinion engine
 */
export function shutdownCodeOpinionEngine(): void {
  codeOpinionEngine = null;
}

export default CodeOpinionEngine;
