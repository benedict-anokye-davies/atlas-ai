/**
 * Atlas Desktop - Learning Suggester
 * Proactively suggests learning resources based on what Ben is working on
 */

import { EventEmitter } from 'events';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createModuleLogger } from '../utils/logger';
import { getErrorMessage } from '../../shared/utils';

const logger = createModuleLogger('LearningSuggester');

// ============================================================================
// Types
// ============================================================================

/**
 * Context about how a topic was detected
 */
export interface LearningContext {
  source: 'code' | 'conversation' | 'search' | 'error';
  frequency: number;
  skillLevel: 'beginner' | 'intermediate' | 'advanced';
}

/**
 * Learning resource
 */
export interface Resource {
  title: string;
  type: 'documentation' | 'video' | 'tutorial' | 'course' | 'book' | 'article';
  url?: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedTime?: string;
  free: boolean;
}

/**
 * Proactive learning suggestion
 */
export interface LearningSuggestion {
  id: string;
  topic: string;
  reason: string;
  resources: Resource[];
  voiceMessage: string;
  createdAt: Date;
  accepted?: boolean;
  declined?: boolean;
}

/**
 * Stored suggestion (serializable)
 */
interface StoredSuggestion {
  id: string;
  topic: string;
  reason: string;
  resources: Resource[];
  voiceMessage: string;
  createdAt: string;
  accepted?: boolean;
  declined?: boolean;
}

/**
 * User's learning progress
 */
export interface LearningProgress {
  topicsTracked: number;
  suggestionsAccepted: number;
  suggestionsDeclined: number;
  topInterests: Interest[];
  learningStreak?: number;
}

/**
 * Detected interest/topic
 */
export interface Interest {
  topic: string;
  frequency: number;
  lastSeen: Date;
  skillLevel: 'beginner' | 'intermediate' | 'advanced';
  suggestedResources: number;
  completedResources: number;
}

/**
 * Stored interest (serializable)
 */
interface StoredInterest {
  topic: string;
  frequency: number;
  lastSeen: string;
  skillLevel: 'beginner' | 'intermediate' | 'advanced';
  suggestedResources: number;
  completedResources: number;
}

/**
 * Learning suggester configuration
 */
export interface LearningSuggesterConfig {
  enabled: boolean;
  maxSuggestionsPerDay: number;
  minFrequencyForSuggestion: number;
  cooldownBetweenSuggestionsMs: number;
  interestDecayDays: number;
}

/**
 * Reading list item
 */
export interface ReadingListItem {
  resource: Resource;
  topic: string;
  addedAt: Date;
  completed: boolean;
  completedAt?: Date;
}

/**
 * Stored reading list item (serializable)
 */
interface StoredReadingListItem {
  resource: Resource;
  topic: string;
  addedAt: string;
  completed: boolean;
  completedAt?: string;
}

/**
 * Learning suggester interface
 */
export interface ILearningSuggester {
  trackLearning(topic: string, context: LearningContext): void;
  suggestResources(topic: string): Resource[];
  generateProactiveSuggestion(): LearningSuggestion | null;
  getLearningProgress(): LearningProgress;
  getDetectedInterests(): Interest[];
}

// ============================================================================
// Constants
// ============================================================================

const ATLAS_DIR = join(homedir(), '.atlas');
const BRAIN_DIR = join(ATLAS_DIR, 'brain', 'learning');
const INTERESTS_FILE = join(BRAIN_DIR, 'interests.json');
const SUGGESTIONS_FILE = join(BRAIN_DIR, 'suggestions.json');
const READING_LIST_FILE = join(BRAIN_DIR, 'reading-list.md');

const DEFAULT_CONFIG: LearningSuggesterConfig = {
  enabled: true,
  maxSuggestionsPerDay: 2,
  minFrequencyForSuggestion: 3,
  cooldownBetweenSuggestionsMs: 4 * 60 * 60 * 1000, // 4 hours
  interestDecayDays: 30,
};

// ============================================================================
// Resource Database
// ============================================================================

const RESOURCE_DATABASE: Record<string, Resource[]> = {
  typescript: [
    {
      title: 'TypeScript Deep Dive',
      type: 'book',
      url: 'https://basarat.gitbook.io/typescript/',
      description: 'Comprehensive TypeScript guide covering advanced patterns',
      difficulty: 'intermediate',
      estimatedTime: '10-15 hours',
      free: true,
    },
    {
      title: 'TypeScript Handbook',
      type: 'documentation',
      url: 'https://www.typescriptlang.org/docs/handbook/',
      description: 'Official TypeScript documentation',
      difficulty: 'beginner',
      estimatedTime: '3-5 hours',
      free: true,
    },
    {
      title: 'Total TypeScript',
      type: 'course',
      url: 'https://www.totaltypescript.com/',
      description: 'Advanced TypeScript patterns by Matt Pocock',
      difficulty: 'advanced',
      estimatedTime: '20+ hours',
      free: false,
    },
    {
      title: 'TypeScript Tips',
      type: 'video',
      url: 'https://www.youtube.com/@maaboroshi',
      description: 'Quick TypeScript tips and tricks',
      difficulty: 'intermediate',
      estimatedTime: '30 min per video',
      free: true,
    },
  ],
  react: [
    {
      title: 'React Documentation',
      type: 'documentation',
      url: 'https://react.dev/',
      description: 'Official React docs with interactive examples',
      difficulty: 'beginner',
      estimatedTime: '5-8 hours',
      free: true,
    },
    {
      title: 'React Patterns',
      type: 'article',
      url: 'https://reactpatterns.com/',
      description: 'Common React patterns and best practices',
      difficulty: 'intermediate',
      free: true,
    },
    {
      title: 'Epic React',
      type: 'course',
      url: 'https://epicreact.dev/',
      description: 'Comprehensive React course by Kent C. Dodds',
      difficulty: 'advanced',
      estimatedTime: '40+ hours',
      free: false,
    },
    {
      title: 'React Hooks Deep Dive',
      type: 'article',
      url: 'https://overreacted.io/',
      description: "Dan Abramov's blog with deep React insights",
      difficulty: 'advanced',
      free: true,
    },
  ],
  electron: [
    {
      title: 'Electron Documentation',
      type: 'documentation',
      url: 'https://www.electronjs.org/docs/latest/',
      description: 'Official Electron documentation',
      difficulty: 'beginner',
      estimatedTime: '4-6 hours',
      free: true,
    },
    {
      title: 'Electron Fiddle',
      type: 'tutorial',
      url: 'https://www.electronjs.org/fiddle',
      description: 'Interactive Electron playground',
      difficulty: 'beginner',
      free: true,
    },
    {
      title: 'Electron Security Best Practices',
      type: 'article',
      url: 'https://www.electronjs.org/docs/latest/tutorial/security',
      description: 'Security checklist for Electron apps',
      difficulty: 'intermediate',
      free: true,
    },
  ],
  websockets: [
    {
      title: 'WebSocket API Guide',
      type: 'documentation',
      url: 'https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API',
      description: 'MDN WebSocket documentation',
      difficulty: 'beginner',
      free: true,
    },
    {
      title: 'WebSocket Patterns',
      type: 'article',
      url: 'https://ably.com/topic/websockets',
      description: 'Advanced WebSocket patterns and best practices',
      difficulty: 'intermediate',
      free: true,
    },
    {
      title: 'Real-time Web with WebSockets',
      type: 'video',
      url: 'https://www.youtube.com/results?search_query=websocket+tutorial',
      description: 'Video tutorials on WebSocket implementation',
      difficulty: 'beginner',
      estimatedTime: '2-3 hours',
      free: true,
    },
  ],
  'async/await': [
    {
      title: 'JavaScript Promises',
      type: 'documentation',
      url: 'https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Asynchronous/Promises',
      description: 'MDN guide to Promises and async/await',
      difficulty: 'beginner',
      free: true,
    },
    {
      title: 'Async JavaScript Deep Dive',
      type: 'article',
      url: 'https://javascript.info/async',
      description: 'Comprehensive guide to async JavaScript',
      difficulty: 'intermediate',
      free: true,
    },
    {
      title: 'Promise Patterns',
      type: 'article',
      url: 'https://www.patterns.dev/posts/promises/',
      description: 'Common Promise patterns and anti-patterns',
      difficulty: 'intermediate',
      free: true,
    },
  ],
  nodejs: [
    {
      title: 'Node.js Documentation',
      type: 'documentation',
      url: 'https://nodejs.org/docs/latest/api/',
      description: 'Official Node.js API documentation',
      difficulty: 'beginner',
      free: true,
    },
    {
      title: 'Node.js Best Practices',
      type: 'article',
      url: 'https://github.com/goldbergyoni/nodebestpractices',
      description: 'Comprehensive Node.js best practices guide',
      difficulty: 'intermediate',
      free: true,
    },
    {
      title: 'Node.js Design Patterns',
      type: 'book',
      url: 'https://www.nodejsdesignpatterns.com/',
      description: 'Design patterns and best practices for Node.js',
      difficulty: 'advanced',
      estimatedTime: '20+ hours',
      free: false,
    },
  ],
  testing: [
    {
      title: 'Testing JavaScript',
      type: 'course',
      url: 'https://testingjavascript.com/',
      description: 'Comprehensive testing course by Kent C. Dodds',
      difficulty: 'intermediate',
      estimatedTime: '15+ hours',
      free: false,
    },
    {
      title: 'Vitest Documentation',
      type: 'documentation',
      url: 'https://vitest.dev/',
      description: 'Vitest testing framework docs',
      difficulty: 'beginner',
      free: true,
    },
    {
      title: 'Testing Library',
      type: 'documentation',
      url: 'https://testing-library.com/docs/',
      description: 'Testing Library documentation',
      difficulty: 'beginner',
      free: true,
    },
  ],
  git: [
    {
      title: 'Pro Git Book',
      type: 'book',
      url: 'https://git-scm.com/book/en/v2',
      description: 'The complete guide to Git',
      difficulty: 'beginner',
      estimatedTime: '10-15 hours',
      free: true,
    },
    {
      title: 'Git Flight Rules',
      type: 'article',
      url: 'https://github.com/k88hudson/git-flight-rules',
      description: 'A guide for when things go wrong with Git',
      difficulty: 'intermediate',
      free: true,
    },
    {
      title: 'Learn Git Branching',
      type: 'tutorial',
      url: 'https://learngitbranching.js.org/',
      description: 'Interactive Git tutorial',
      difficulty: 'beginner',
      estimatedTime: '2-3 hours',
      free: true,
    },
  ],
  docker: [
    {
      title: 'Docker Documentation',
      type: 'documentation',
      url: 'https://docs.docker.com/get-started/',
      description: 'Official Docker getting started guide',
      difficulty: 'beginner',
      free: true,
    },
    {
      title: 'Docker Deep Dive',
      type: 'book',
      description: 'Comprehensive Docker guide',
      difficulty: 'intermediate',
      estimatedTime: '10-15 hours',
      free: false,
    },
    {
      title: 'Docker for Node.js',
      type: 'article',
      url: 'https://nodejs.org/en/docs/guides/nodejs-docker-webapp/',
      description: 'Dockerizing Node.js applications',
      difficulty: 'intermediate',
      free: true,
    },
  ],
  sql: [
    {
      title: 'SQLBolt',
      type: 'tutorial',
      url: 'https://sqlbolt.com/',
      description: 'Interactive SQL lessons',
      difficulty: 'beginner',
      estimatedTime: '3-4 hours',
      free: true,
    },
    {
      title: 'PostgreSQL Tutorial',
      type: 'documentation',
      url: 'https://www.postgresqltutorial.com/',
      description: 'PostgreSQL specific tutorials',
      difficulty: 'beginner',
      free: true,
    },
    {
      title: 'SQL Performance Explained',
      type: 'book',
      url: 'https://use-the-index-luke.com/',
      description: 'SQL indexing and performance guide',
      difficulty: 'advanced',
      free: true,
    },
  ],
  graphql: [
    {
      title: 'GraphQL Documentation',
      type: 'documentation',
      url: 'https://graphql.org/learn/',
      description: 'Official GraphQL learning resources',
      difficulty: 'beginner',
      free: true,
    },
    {
      title: 'How to GraphQL',
      type: 'tutorial',
      url: 'https://www.howtographql.com/',
      description: 'Full-stack GraphQL tutorial',
      difficulty: 'intermediate',
      estimatedTime: '5-8 hours',
      free: true,
    },
  ],
  css: [
    {
      title: 'CSS Tricks',
      type: 'article',
      url: 'https://css-tricks.com/',
      description: 'Tips, tricks, and techniques on CSS',
      difficulty: 'beginner',
      free: true,
    },
    {
      title: 'Flexbox Froggy',
      type: 'tutorial',
      url: 'https://flexboxfroggy.com/',
      description: 'Interactive game to learn Flexbox',
      difficulty: 'beginner',
      estimatedTime: '1-2 hours',
      free: true,
    },
    {
      title: 'CSS Grid Garden',
      type: 'tutorial',
      url: 'https://cssgridgarden.com/',
      description: 'Interactive game to learn CSS Grid',
      difficulty: 'beginner',
      estimatedTime: '1-2 hours',
      free: true,
    },
    {
      title: 'Modern CSS',
      type: 'article',
      url: 'https://moderncss.dev/',
      description: 'Modern CSS solutions for old problems',
      difficulty: 'intermediate',
      free: true,
    },
  ],
  security: [
    {
      title: 'OWASP Top 10',
      type: 'documentation',
      url: 'https://owasp.org/www-project-top-ten/',
      description: 'Top 10 web security risks',
      difficulty: 'intermediate',
      free: true,
    },
    {
      title: 'Web Security Academy',
      type: 'course',
      url: 'https://portswigger.net/web-security',
      description: 'Free web security training',
      difficulty: 'intermediate',
      estimatedTime: '40+ hours',
      free: true,
    },
  ],
  performance: [
    {
      title: 'web.dev Performance',
      type: 'documentation',
      url: 'https://web.dev/performance/',
      description: 'Google web performance guides',
      difficulty: 'intermediate',
      free: true,
    },
    {
      title: 'High Performance Browser Networking',
      type: 'book',
      url: 'https://hpbn.co/',
      description: 'Deep dive into networking performance',
      difficulty: 'advanced',
      free: true,
    },
  ],
  'machine-learning': [
    {
      title: 'Fast.ai',
      type: 'course',
      url: 'https://www.fast.ai/',
      description: 'Practical deep learning for coders',
      difficulty: 'intermediate',
      estimatedTime: '50+ hours',
      free: true,
    },
    {
      title: 'ML Crash Course',
      type: 'course',
      url: 'https://developers.google.com/machine-learning/crash-course',
      description: 'Google ML crash course',
      difficulty: 'beginner',
      estimatedTime: '15 hours',
      free: true,
    },
  ],
  ai: [
    {
      title: 'OpenAI Documentation',
      type: 'documentation',
      url: 'https://platform.openai.com/docs/',
      description: 'OpenAI API documentation',
      difficulty: 'beginner',
      free: true,
    },
    {
      title: 'LangChain Documentation',
      type: 'documentation',
      url: 'https://js.langchain.com/docs/',
      description: 'LangChain.js for building LLM apps',
      difficulty: 'intermediate',
      free: true,
    },
    {
      title: 'Prompt Engineering Guide',
      type: 'article',
      url: 'https://www.promptingguide.ai/',
      description: 'Comprehensive prompt engineering guide',
      difficulty: 'beginner',
      free: true,
    },
  ],
  rust: [
    {
      title: 'The Rust Book',
      type: 'book',
      url: 'https://doc.rust-lang.org/book/',
      description: 'Official Rust programming language book',
      difficulty: 'beginner',
      estimatedTime: '20+ hours',
      free: true,
    },
    {
      title: 'Rustlings',
      type: 'tutorial',
      url: 'https://github.com/rust-lang/rustlings',
      description: 'Small exercises to learn Rust',
      difficulty: 'beginner',
      estimatedTime: '5-10 hours',
      free: true,
    },
  ],
  python: [
    {
      title: 'Python Documentation',
      type: 'documentation',
      url: 'https://docs.python.org/3/',
      description: 'Official Python documentation',
      difficulty: 'beginner',
      free: true,
    },
    {
      title: 'Automate the Boring Stuff',
      type: 'book',
      url: 'https://automatetheboringstuff.com/',
      description: 'Practical programming for beginners',
      difficulty: 'beginner',
      estimatedTime: '15-20 hours',
      free: true,
    },
  ],
};

// Topic aliases for better matching
const TOPIC_ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  javascript: 'typescript', // Often related
  promise: 'async/await',
  promises: 'async/await',
  async: 'async/await',
  await: 'async/await',
  node: 'nodejs',
  'node.js': 'nodejs',
  test: 'testing',
  tests: 'testing',
  jest: 'testing',
  vitest: 'testing',
  mocha: 'testing',
  container: 'docker',
  containers: 'docker',
  k8s: 'kubernetes',
  postgres: 'sql',
  postgresql: 'sql',
  mysql: 'sql',
  database: 'sql',
  db: 'sql',
  style: 'css',
  styles: 'css',
  styling: 'css',
  tailwind: 'css',
  scss: 'css',
  sass: 'css',
  ml: 'machine-learning',
  'deep learning': 'machine-learning',
  llm: 'ai',
  gpt: 'ai',
  openai: 'ai',
  langchain: 'ai',
  ws: 'websockets',
  websocket: 'websockets',
  'socket.io': 'websockets',
  hooks: 'react',
  'react hooks': 'react',
  jsx: 'react',
  tsx: 'react',
};

// JARVIS-style voice message templates
const VOICE_TEMPLATES = {
  workingWith: [
    "Ben, I noticed you're working with {topic} a lot. {resource} - want me to bookmark it?",
    "You've been spending time on {topic}. I found {resource} that might help. Should I save it?",
    'Looks like {topic} is on your radar. {resource} could be useful - interested?',
  ],
  debugging: [
    "You've been debugging {topic} issues. {resource} might help - shall I save it?",
    'I see some {topic} challenges. {resource} could clear things up. Want me to add it to your list?',
    "Those {topic} errors you're seeing - {resource} has good solutions. Bookmark it?",
  ],
  learning: [
    'Based on your {topic} work, you might find {resource} useful. Want me to add it to your reading list?',
    'Your {topic} skills are growing. {resource} could take you further - interested?',
    "I've noticed your interest in {topic}. {resource} is highly recommended. Should I save it?",
  ],
  general: [
    'Ben, {resource} on {topic} caught my attention. Might be worth a look - save it?',
    'Quick suggestion: {resource} for {topic}. Want it on your reading list?',
    'Found something good: {resource} about {topic}. Shall I bookmark it?',
  ],
};

// ============================================================================
// Learning Suggester Implementation
// ============================================================================

/**
 * LearningSuggester - Proactively suggests learning resources
 */
export class LearningSuggester extends EventEmitter implements ILearningSuggester {
  private config: LearningSuggesterConfig;
  private interests: Map<string, Interest> = new Map();
  private suggestions: LearningSuggestion[] = [];
  private readingList: ReadingListItem[] = [];
  private lastSuggestionTime: number = 0;
  private suggestionsToday: number = 0;
  private lastSuggestionDate: string = '';

  constructor(config?: Partial<LearningSuggesterConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ensureDirectoriesExist();
    this.loadFromDisk();
    this.resetDailyCounterIfNeeded();
    logger.info('LearningSuggester initialized', {
      interests: this.interests.size,
      suggestions: this.suggestions.length,
    });
  }

  /**
   * Track a learning topic
   */
  trackLearning(topic: string, context: LearningContext): void {
    if (!this.config.enabled) return;

    const normalizedTopic = this.normalizeTopic(topic);
    if (!normalizedTopic) {
      logger.debug('Topic not recognized', { topic });
      return;
    }

    const existing = this.interests.get(normalizedTopic);

    if (existing) {
      // Update existing interest
      existing.frequency += context.frequency;
      existing.lastSeen = new Date();
      // Update skill level if higher context provided
      if (this.skillLevelValue(context.skillLevel) > this.skillLevelValue(existing.skillLevel)) {
        existing.skillLevel = context.skillLevel;
      }
      this.interests.set(normalizedTopic, existing);
    } else {
      // Create new interest
      const interest: Interest = {
        topic: normalizedTopic,
        frequency: context.frequency,
        lastSeen: new Date(),
        skillLevel: context.skillLevel,
        suggestedResources: 0,
        completedResources: 0,
      };
      this.interests.set(normalizedTopic, interest);
    }

    logger.debug('Learning tracked', {
      topic: normalizedTopic,
      source: context.source,
      frequency: context.frequency,
    });

    this.emit('learning-tracked', { topic: normalizedTopic, context });
    this.saveToDisk();
  }

  /**
   * Manually add a topic to track
   */
  addTopic(topic: string, skillLevel: 'beginner' | 'intermediate' | 'advanced' = 'beginner'): void {
    this.trackLearning(topic, {
      source: 'conversation',
      frequency: 1,
      skillLevel,
    });
  }

  /**
   * Get suggested resources for a topic
   */
  suggestResources(topic: string): Resource[] {
    const normalizedTopic = this.normalizeTopic(topic);
    if (!normalizedTopic) return [];

    const resources = RESOURCE_DATABASE[normalizedTopic] || [];
    const interest = this.interests.get(normalizedTopic);
    const skillLevel = interest?.skillLevel || 'beginner';

    // Filter and sort by skill level appropriateness
    return resources
      .filter((r) => this.isResourceAppropriate(r, skillLevel))
      .sort((a, b) => {
        // Prioritize matching difficulty
        const aDiff = Math.abs(
          this.difficultyValue(a.difficulty) - this.skillLevelValue(skillLevel)
        );
        const bDiff = Math.abs(
          this.difficultyValue(b.difficulty) - this.skillLevelValue(skillLevel)
        );
        if (aDiff !== bDiff) return aDiff - bDiff;
        // Then prefer free resources
        if (a.free !== b.free) return a.free ? -1 : 1;
        return 0;
      });
  }

  /**
   * Generate a proactive suggestion based on tracked interests
   */
  generateProactiveSuggestion(): LearningSuggestion | null {
    if (!this.config.enabled) return null;

    // Check rate limiting
    this.resetDailyCounterIfNeeded();
    if (this.suggestionsToday >= this.config.maxSuggestionsPerDay) {
      logger.debug('Daily suggestion limit reached');
      return null;
    }

    const now = Date.now();
    if (now - this.lastSuggestionTime < this.config.cooldownBetweenSuggestionsMs) {
      logger.debug('Suggestion cooldown active');
      return null;
    }

    // Find best topic to suggest
    const candidateTopics = this.getCandidateTopics();
    if (candidateTopics.length === 0) {
      logger.debug('No candidate topics for suggestion');
      return null;
    }

    // Pick the best candidate
    const topic = candidateTopics[0];
    const interest = this.interests.get(topic);
    if (!interest) return null;

    // Get resources for this topic
    const resources = this.suggestResources(topic);
    if (resources.length === 0) {
      logger.debug('No resources available for topic', { topic });
      return null;
    }

    // Pick top 2-3 resources
    const selectedResources = resources.slice(0, 3);

    // Generate voice message
    const voiceMessage = this.generateVoiceMessage(topic, selectedResources[0], interest);
    const reason = this.generateReason(topic, interest);

    const suggestion: LearningSuggestion = {
      id: this.generateId(),
      topic,
      reason,
      resources: selectedResources,
      voiceMessage,
      createdAt: new Date(),
    };

    // Update tracking
    this.lastSuggestionTime = now;
    this.suggestionsToday++;
    interest.suggestedResources++;
    this.interests.set(topic, interest);
    this.suggestions.push(suggestion);

    this.saveToDisk();
    this.emit('suggestion-generated', suggestion);

    logger.info('Proactive suggestion generated', {
      topic,
      resources: selectedResources.length,
    });

    return suggestion;
  }

  /**
   * Accept a suggestion (adds resources to reading list)
   */
  acceptSuggestion(suggestionId: string): void {
    const suggestion = this.suggestions.find((s) => s.id === suggestionId);
    if (!suggestion) return;

    suggestion.accepted = true;

    // Add resources to reading list
    for (const resource of suggestion.resources) {
      this.addToReadingList(resource, suggestion.topic);
    }

    this.saveToDisk();
    this.emit('suggestion-accepted', suggestion);
    logger.info('Suggestion accepted', { suggestionId, topic: suggestion.topic });
  }

  /**
   * Decline a suggestion
   */
  declineSuggestion(suggestionId: string): void {
    const suggestion = this.suggestions.find((s) => s.id === suggestionId);
    if (!suggestion) return;

    suggestion.declined = true;
    this.saveToDisk();
    this.emit('suggestion-declined', suggestion);
    logger.info('Suggestion declined', { suggestionId, topic: suggestion.topic });
  }

  /**
   * Add a resource to the reading list
   */
  addToReadingList(resource: Resource, topic: string): void {
    // Check if already in list
    const exists = this.readingList.some(
      (item) => item.resource.title === resource.title && item.resource.url === resource.url
    );
    if (exists) return;

    this.readingList.push({
      resource,
      topic,
      addedAt: new Date(),
      completed: false,
    });

    this.saveReadingList();
    this.emit('reading-list-updated', this.readingList);
  }

  /**
   * Mark a reading list item as completed
   */
  completeReadingListItem(title: string): void {
    const item = this.readingList.find((i) => i.resource.title === title && !i.completed);
    if (!item) return;

    item.completed = true;
    item.completedAt = new Date();

    // Update interest completed count
    const interest = this.interests.get(item.topic);
    if (interest) {
      interest.completedResources++;
      this.interests.set(item.topic, interest);
    }

    this.saveReadingList();
    this.saveToDisk();
    this.emit('resource-completed', item);
  }

  /**
   * Get the reading list
   */
  getReadingList(): ReadingListItem[] {
    return [...this.readingList];
  }

  /**
   * Get learning progress
   */
  getLearningProgress(): LearningProgress {
    const interests = Array.from(this.interests.values());
    const acceptedCount = this.suggestions.filter((s) => s.accepted).length;
    const declinedCount = this.suggestions.filter((s) => s.declined).length;

    // Calculate learning streak
    const streak = this.calculateLearningStreak();

    // Get top interests by frequency
    const topInterests = interests.sort((a, b) => b.frequency - a.frequency).slice(0, 5);

    return {
      topicsTracked: interests.length,
      suggestionsAccepted: acceptedCount,
      suggestionsDeclined: declinedCount,
      topInterests,
      learningStreak: streak,
    };
  }

  /**
   * Get all detected interests
   */
  getDetectedInterests(): Interest[] {
    return Array.from(this.interests.values()).sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Get recent suggestions
   */
  getRecentSuggestions(limit: number = 10): LearningSuggestion[] {
    return this.suggestions.slice(-limit).reverse();
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<LearningSuggesterConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Configuration updated', { enabled: this.config.enabled });
  }

  /**
   * Clear all data (for testing)
   */
  clearAll(): void {
    this.interests.clear();
    this.suggestions = [];
    this.readingList = [];
    this.lastSuggestionTime = 0;
    this.suggestionsToday = 0;
    this.saveToDisk();
    this.saveReadingList();
    logger.info('All learning data cleared');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Normalize topic name using aliases
   */
  private normalizeTopic(topic: string): string | null {
    const lower = topic.toLowerCase().trim();

    // Check direct match in database
    if (RESOURCE_DATABASE[lower]) {
      return lower;
    }

    // Check aliases
    if (TOPIC_ALIASES[lower]) {
      return TOPIC_ALIASES[lower];
    }

    // Check partial matches
    for (const [alias, normalized] of Object.entries(TOPIC_ALIASES)) {
      if (lower.includes(alias) || alias.includes(lower)) {
        return normalized;
      }
    }

    // Check database keys for partial match
    for (const key of Object.keys(RESOURCE_DATABASE)) {
      if (lower.includes(key) || key.includes(lower)) {
        return key;
      }
    }

    return null;
  }

  /**
   * Get candidate topics for suggestion
   */
  private getCandidateTopics(): string[] {
    const now = Date.now();
    const decayCutoff = now - this.config.interestDecayDays * 24 * 60 * 60 * 1000;

    return Array.from(this.interests.entries())
      .filter(([_, interest]) => {
        // Must have enough frequency
        if (interest.frequency < this.config.minFrequencyForSuggestion) return false;
        // Must be recent enough
        if (interest.lastSeen.getTime() < decayCutoff) return false;
        // Must have resources available
        if (!RESOURCE_DATABASE[interest.topic]) return false;
        // Shouldn't have too many suggestions already
        if (interest.suggestedResources > 5) return false;
        return true;
      })
      .sort((a, b) => {
        // Sort by: frequency * recency factor
        const aRecency =
          1 -
          (now - a[1].lastSeen.getTime()) / (this.config.interestDecayDays * 24 * 60 * 60 * 1000);
        const bRecency =
          1 -
          (now - b[1].lastSeen.getTime()) / (this.config.interestDecayDays * 24 * 60 * 60 * 1000);
        return b[1].frequency * bRecency - a[1].frequency * aRecency;
      })
      .map(([topic]) => topic);
  }

  /**
   * Check if a resource is appropriate for the skill level
   */
  private isResourceAppropriate(
    resource: Resource,
    skillLevel: 'beginner' | 'intermediate' | 'advanced'
  ): boolean {
    const resourceLevel = this.difficultyValue(resource.difficulty);
    const userLevel = this.skillLevelValue(skillLevel);
    // Allow resources at same level or one level higher
    return resourceLevel <= userLevel + 1;
  }

  /**
   * Convert skill level to numeric value
   */
  private skillLevelValue(level: 'beginner' | 'intermediate' | 'advanced'): number {
    switch (level) {
      case 'beginner':
        return 1;
      case 'intermediate':
        return 2;
      case 'advanced':
        return 3;
    }
  }

  /**
   * Convert difficulty to numeric value
   */
  private difficultyValue(difficulty: 'beginner' | 'intermediate' | 'advanced'): number {
    return this.skillLevelValue(difficulty);
  }

  /**
   * Generate a JARVIS-style voice message
   */
  private generateVoiceMessage(topic: string, resource: Resource, interest: Interest): string {
    // Pick template category based on context
    let templates: string[];
    if (interest.frequency > 10) {
      templates = VOICE_TEMPLATES.workingWith;
    } else if (interest.skillLevel === 'beginner') {
      templates = VOICE_TEMPLATES.learning;
    } else {
      templates = VOICE_TEMPLATES.general;
    }

    // Pick random template
    const template = templates[Math.floor(Math.random() * templates.length)];

    // Format resource description
    const resourceDesc =
      resource.type === 'book' || resource.type === 'course'
        ? `a great ${resource.type} called "${resource.title}"`
        : `this ${resource.type} on "${resource.title}"`;

    return template.replace('{topic}', topic).replace('{resource}', resourceDesc);
  }

  /**
   * Generate reason for suggestion
   */
  private generateReason(topic: string, interest: Interest): string {
    if (interest.frequency > 20) {
      return `You've been working extensively with ${topic} (${interest.frequency} interactions).`;
    } else if (interest.frequency > 10) {
      return `${topic} has been coming up frequently in your work.`;
    } else {
      return `I noticed your interest in ${topic}.`;
    }
  }

  /**
   * Calculate learning streak (consecutive days with completed resources)
   */
  private calculateLearningStreak(): number {
    const completedItems = this.readingList
      .filter((item) => item.completed && item.completedAt)
      .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime());

    if (completedItems.length === 0) return 0;

    let streak = 0;
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    for (const item of completedItems) {
      const itemDate = new Date(item.completedAt!);
      itemDate.setHours(0, 0, 0, 0);

      const daysDiff = Math.floor(
        (currentDate.getTime() - itemDate.getTime()) / (24 * 60 * 60 * 1000)
      );

      if (daysDiff === streak || daysDiff === streak + 1) {
        streak = daysDiff + 1;
      } else {
        break;
      }
    }

    return streak;
  }

  /**
   * Reset daily suggestion counter if it's a new day
   */
  private resetDailyCounterIfNeeded(): void {
    const today = new Date().toDateString();
    if (this.lastSuggestionDate !== today) {
      this.lastSuggestionDate = today;
      this.suggestionsToday = 0;
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `ls-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  // ============================================================================
  // Persistence
  // ============================================================================

  private ensureDirectoriesExist(): void {
    for (const dir of [ATLAS_DIR, BRAIN_DIR]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  private loadFromDisk(): void {
    try {
      // Load interests
      if (existsSync(INTERESTS_FILE)) {
        const data = readFileSync(INTERESTS_FILE, 'utf-8');
        const stored: StoredInterest[] = JSON.parse(data);
        for (const item of stored) {
          this.interests.set(item.topic, {
            ...item,
            lastSeen: new Date(item.lastSeen),
          });
        }
        logger.debug('Loaded interests', { count: this.interests.size });
      }

      // Load suggestions
      if (existsSync(SUGGESTIONS_FILE)) {
        const data = readFileSync(SUGGESTIONS_FILE, 'utf-8');
        const stored: StoredSuggestion[] = JSON.parse(data);
        this.suggestions = stored.map((s) => ({
          ...s,
          createdAt: new Date(s.createdAt),
        }));
        logger.debug('Loaded suggestions', { count: this.suggestions.length });
      }

      // Load reading list from markdown
      this.loadReadingList();
    } catch (error) {
      logger.error('Failed to load from disk', {
        error: getErrorMessage(error),
      });
    }
  }

  private saveToDisk(): void {
    try {
      // Save interests
      const storedInterests: StoredInterest[] = Array.from(this.interests.values()).map((i) => ({
        ...i,
        lastSeen: i.lastSeen.toISOString(),
      }));
      writeFileSync(INTERESTS_FILE, JSON.stringify(storedInterests, null, 2));

      // Save suggestions
      const storedSuggestions: StoredSuggestion[] = this.suggestions.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
      }));
      writeFileSync(SUGGESTIONS_FILE, JSON.stringify(storedSuggestions, null, 2));

      logger.debug('Saved to disk', {
        interests: this.interests.size,
        suggestions: this.suggestions.length,
      });
    } catch (error) {
      logger.error('Failed to save to disk', {
        error: getErrorMessage(error),
      });
    }
  }

  private loadReadingList(): void {
    try {
      if (!existsSync(READING_LIST_FILE)) {
        this.readingList = [];
        return;
      }

      const content = readFileSync(READING_LIST_FILE, 'utf-8');
      const items: ReadingListItem[] = [];

      // Parse markdown format
      const lines = content.split('\n');
      let currentItem: Partial<StoredReadingListItem> | null = null;

      for (const line of lines) {
        // Match: - [ ] or - [x] Title (type)
        const match = line.match(/^- \[([ x])\] \*\*(.+?)\*\* \((\w+)\)/);
        if (match) {
          if (currentItem && currentItem.resource) {
            items.push({
              resource: currentItem.resource,
              topic: currentItem.topic || 'unknown',
              addedAt: currentItem.addedAt ? new Date(currentItem.addedAt) : new Date(),
              completed: currentItem.completed || false,
              completedAt: currentItem.completedAt ? new Date(currentItem.completedAt) : undefined,
            });
          }

          const completed = match[1] === 'x';
          const title = match[2];
          const type = match[3] as Resource['type'];

          currentItem = {
            resource: {
              title,
              type,
              description: '',
              difficulty: 'intermediate',
              free: true,
            },
            completed,
          };
        } else if (currentItem && line.startsWith('  - Topic:')) {
          currentItem.topic = line.replace('  - Topic:', '').trim();
        } else if (currentItem && line.startsWith('  - URL:')) {
          currentItem.resource!.url = line.replace('  - URL:', '').trim();
        } else if (currentItem && line.startsWith('  - Added:')) {
          currentItem.addedAt = line.replace('  - Added:', '').trim();
        }
      }

      // Don't forget last item
      if (currentItem && currentItem.resource) {
        items.push({
          resource: currentItem.resource,
          topic: currentItem.topic || 'unknown',
          addedAt: currentItem.addedAt ? new Date(currentItem.addedAt) : new Date(),
          completed: currentItem.completed || false,
          completedAt: currentItem.completedAt ? new Date(currentItem.completedAt) : undefined,
        });
      }

      this.readingList = items;
      logger.debug('Loaded reading list', { count: items.length });
    } catch (error) {
      logger.error('Failed to load reading list', {
        error: getErrorMessage(error),
      });
      this.readingList = [];
    }
  }

  private saveReadingList(): void {
    try {
      // Generate markdown content
      let content = '# Reading List\n\n';
      content += `*Last updated: ${new Date().toISOString()}*\n\n`;

      // Group by topic
      const byTopic = new Map<string, ReadingListItem[]>();
      for (const item of this.readingList) {
        const existing = byTopic.get(item.topic) || [];
        existing.push(item);
        byTopic.set(item.topic, existing);
      }

      // Write each topic section
      for (const [topic, items] of Array.from(byTopic.entries())) {
        content += `## ${topic.charAt(0).toUpperCase() + topic.slice(1)}\n\n`;

        for (const item of items) {
          const checkbox = item.completed ? '[x]' : '[ ]';
          content += `- ${checkbox} **${item.resource.title}** (${item.resource.type})\n`;
          content += `  - Topic: ${item.topic}\n`;
          if (item.resource.url) {
            content += `  - URL: ${item.resource.url}\n`;
          }
          content += `  - Added: ${item.addedAt.toISOString()}\n`;
          if (item.completed && item.completedAt) {
            content += `  - Completed: ${item.completedAt.toISOString()}\n`;
          }
          content += '\n';
        }
      }

      writeFileSync(READING_LIST_FILE, content);
      logger.debug('Saved reading list', { count: this.readingList.length });
    } catch (error) {
      logger.error('Failed to save reading list', {
        error: getErrorMessage(error),
      });
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let learningSuggester: LearningSuggester | null = null;

/**
 * Get or create the learning suggester singleton
 */
export function getLearningSuggester(): LearningSuggester {
  if (!learningSuggester) {
    learningSuggester = new LearningSuggester();
  }
  return learningSuggester;
}

/**
 * Initialize the learning suggester with custom config
 */
export function initializeLearningSuggester(
  config?: Partial<LearningSuggesterConfig>
): LearningSuggester {
  if (learningSuggester) {
    learningSuggester.setConfig(config || {});
    return learningSuggester;
  }
  learningSuggester = new LearningSuggester(config);
  return learningSuggester;
}

/**
 * Shutdown the learning suggester
 */
export function shutdownLearningSuggester(): void {
  if (learningSuggester) {
    learningSuggester = null;
  }
  logger.info('Learning suggester shutdown complete');
}

/**
 * Reset the learning suggester (for testing)
 */
export function resetLearningSuggester(): void {
  if (learningSuggester) {
    learningSuggester.clearAll();
    learningSuggester = null;
  }
}

export default LearningSuggester;
