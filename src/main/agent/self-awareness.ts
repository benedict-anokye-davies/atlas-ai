/**
 * Atlas Desktop - Self Awareness Module
 * Enables Atlas to understand its own codebase, architecture, and capabilities
 */

import { createModuleLogger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const logger = createModuleLogger('SelfAwareness');

// ============================================================================
// Interfaces
// ============================================================================

export interface SelfAwareness {
  /** Get own source files */
  getOwnSourceFiles(): string[];
  /** Understand own architecture */
  getArchitectureMap(): ArchitectureMap;
  /** Know own capabilities */
  getCapabilities(): Capability[];
  /** Understand own limitations */
  getLimitations(): string[];
  /** Explain how a feature works */
  explainFeature(featureName: string): string;
  /** Find where something is implemented */
  findImplementation(concept: string): FileLocation[];
}

export interface ArchitectureMap {
  mainProcess: ModuleInfo[];
  renderer: ModuleInfo[];
  shared: ModuleInfo[];
  entryPoints: string[];
}

export interface ModuleInfo {
  path: string;
  name: string;
  description: string;
  exports: string[];
  dependencies: string[];
}

export interface Capability {
  name: string;
  description: string;
  implementation: string;
  status: 'active' | 'partial' | 'planned';
}

export interface FileLocation {
  file: string;
  line?: number;
  description: string;
}

interface FileIndex {
  path: string;
  relativePath: string;
  name: string;
  modifiedTime: number;
  exports: string[];
  imports: string[];
  classes: string[];
  functions: string[];
  interfaces: string[];
}

interface CodebaseIndex {
  files: Map<string, FileIndex>;
  lastIndexed: number;
  projectRoot: string;
}

// ============================================================================
// Module Descriptions (Static Knowledge)
// ============================================================================

const MODULE_DESCRIPTIONS: Record<string, string> = {
  // Main process modules
  voice:
    'Voice pipeline components including wake word detection, voice activity detection (VAD), and audio processing orchestration',
  stt: 'Speech-to-text integrations with Deepgram (primary) and Vosk (offline fallback)',
  tts: 'Text-to-speech with ElevenLabs streaming (primary) and system voice fallback',
  llm: 'Language model integrations with Fireworks AI (DeepSeek V3.1) and OpenRouter fallback',
  agent: 'Agent tools, personality management, skill system, and task execution framework',
  memory: 'Memory and context systems for conversation history and semantic understanding',
  security: 'Security layer including permissions, sandboxing, input validation, and audit logging',
  config: 'Configuration management for API keys, settings, and environment variables',
  utils: 'Utility functions including logging (Winston), error handling, and helpers',
  ipc: 'Inter-process communication handlers between main and renderer processes',
  tray: 'System tray integration for background operation',
  window: 'Window management and display modes',
  cache: 'Caching strategies and cache manager for performance optimization',
  network: 'Network optimization and connection management',
  workers: 'Worker pool and background processing for audio and embeddings',
  integrations: 'Third-party integrations (Spotify, Calendar, Email, etc.)',
  finance: 'Financial features including TrueLayer banking and budget tracking',
  gepa: 'Guided Evolutionary Prompt Architecture for self-improvement',
  ml: 'Machine learning components including speaker ID and custom wake words',
  dev: 'Development helpers, performance profiling, and state persistence',
  shortcuts: 'Global keyboard shortcut handling',
  i18n: 'Internationalization support',
  accessibility: 'Accessibility features and screen reader support',
  communication: 'Communication tools including Twilio integration',
  // Renderer modules
  'components/orb':
    '3D particle orb visualization using React Three Fiber with strange attractor animations',
  'components/dashboard': 'Dashboard UI components for system monitoring and control',
  'components/onboarding': 'User onboarding flow and setup wizard',
  'components/common': 'Reusable UI components',
  'components/accessibility': 'Accessible UI components with ARIA support',
  hooks: 'React hooks for state management, audio analysis, and performance monitoring',
  stores: 'Zustand stores for application state (atlas, transcript, notifications, etc.)',
  themes: 'Visual theme definitions and customization',
  // Shared
  'shared/types': 'TypeScript type definitions shared between main and renderer processes',
};

const FEATURE_EXPLANATIONS: Record<string, string> = {
  'wake-word': `Wake word detection uses Porcupine from Picovoice to listen for "Hey Atlas" or custom wake phrases. 
Implementation: src/main/voice/wake-word.ts
Flow: Audio stream → Porcupine SDK → Detection event → Voice pipeline activation
The system supports custom wake word training via wake-word-trainer.ts.`,

  'voice-pipeline': `The voice pipeline orchestrates the entire voice interaction flow.
Implementation: src/main/voice/voice-pipeline.ts
Flow: Wake Word → VAD (Voice Activity Detection) → STT (Speech-to-Text) → LLM → TTS (Text-to-Speech)
It handles state transitions, audio buffering, and error recovery.`,

  'speech-recognition': `Speech recognition converts spoken audio to text using multiple providers.
Primary: Deepgram (src/main/stt/deepgram.ts) - Real-time WebSocket streaming with Nova-2 model
Fallback: Vosk (src/main/stt/vosk.ts) - Offline recognition for privacy or connectivity issues
The system automatically falls back when the primary fails.`,

  'text-to-speech': `Text-to-speech converts Atlas responses to natural speech.
Primary: ElevenLabs (src/main/tts/elevenlabs.ts) - Streaming synthesis for low latency
Fallback: System voices (src/main/tts/offline.ts) - Built-in OS speech synthesis
Supports barge-in detection to stop speaking when user interrupts.`,

  'llm-processing': `Language model processing handles understanding and response generation.
Primary: Fireworks AI (src/main/llm/fireworks.ts) - DeepSeek V3.1 model
Fallback: OpenRouter (src/main/llm/openrouter.ts) - Multi-model routing
Includes tool calling support for agent capabilities.`,

  'particle-orb': `The visual orb uses React Three Fiber for 3D rendering.
Implementation: src/renderer/components/orb/
Features: Strange attractor particles (Aizawa), state-based animations, mouse interaction
Uses instanced rendering for performance with thousands of particles.`,

  'agent-tools': `Agent tools provide Atlas with capabilities to interact with the system.
Implementation: src/main/agent/tools/ directory
Categories: filesystem, terminal, browser, system, memory, search, utility, git
Each tool has safety validation and optional user confirmation.`,

  'memory-system': `The memory system maintains context and conversation history.
Implementation: src/main/memory/
Features: Conversation memory, semantic chunking, context building
Planned: LanceDB vector storage for long-term memory.`,

  security: `The security layer protects against malicious operations.
Implementation: src/main/security/
Features: Permission management, sandboxing, input validation, rate limiting, audit logging
Blocks dangerous file paths and commands automatically.`,

  personality: `Personality management gives Atlas its unique character.
Implementation: src/main/agent/personality-manager.ts
Features: Dynamic responses, humor integration, contextual greetings, signoff messages
Adapts tone based on context and user preferences.`,

  'task-system': `The task system handles complex multi-step operations.
Implementation: src/main/agent/task-framework.ts, task-executor.ts, task-queue.ts
Features: Task planning, execution tracking, status updates, error recovery
Supports parallel and sequential task execution.`,

  skills: `The skill system extends Atlas capabilities with pluggable modules.
Implementation: src/main/agent/skill-manager.ts, skills/ directory
Features: Dynamic skill loading, context-aware selection, skill chaining
Built-in skills include search, file operations, and more.`,
};

const KNOWN_LIMITATIONS: string[] = [
  'Cannot access files outside permitted directories without explicit user permission',
  'Voice recognition accuracy depends on microphone quality and ambient noise',
  'LLM responses may occasionally be inaccurate or hallucinate information',
  'Real-time operations require stable network for cloud services (STT, LLM, TTS)',
  'Cannot execute truly arbitrary code - terminal commands are sandboxed and validated',
  'Memory system has finite context window - very long conversations may lose early context',
  'Cannot directly control mouse/keyboard without accessibility permissions',
  'Browser automation requires specific browser integrations to be configured',
  'Cannot access encrypted or DRM-protected content',
  'Speaker identification requires enrollment and may have accuracy limitations',
  'Custom wake word training requires multiple samples and may not work in all accents',
  'Financial integrations require OAuth setup with respective services',
  'Email/calendar access requires explicit authorization and API keys',
  'Cannot modify system-level settings or registry without admin permissions',
];

const CAPABILITY_DEFINITIONS: Capability[] = [
  // Voice & Audio
  {
    name: 'Wake Word Detection',
    description: 'Listen for "Hey Atlas" to activate voice input',
    implementation: 'src/main/voice/wake-word.ts',
    status: 'active',
  },
  {
    name: 'Voice Activity Detection',
    description: 'Detect when user is speaking vs silence',
    implementation: 'src/main/voice/vad.ts',
    status: 'active',
  },
  {
    name: 'Speech Recognition',
    description: 'Convert spoken words to text',
    implementation: 'src/main/stt/',
    status: 'active',
  },
  {
    name: 'Text to Speech',
    description: 'Convert text responses to natural speech',
    implementation: 'src/main/tts/',
    status: 'active',
  },
  {
    name: 'Speaker Identification',
    description: 'Recognize different speakers by voice',
    implementation: 'src/main/ml/speaker-id/',
    status: 'partial',
  },
  {
    name: 'Custom Wake Words',
    description: 'Train custom activation phrases',
    implementation: 'src/main/voice/wake-word-trainer.ts',
    status: 'partial',
  },

  // LLM & Intelligence
  {
    name: 'Natural Language Understanding',
    description: 'Understand user intent from natural speech',
    implementation: 'src/main/llm/',
    status: 'active',
  },
  {
    name: 'Contextual Responses',
    description: 'Generate contextually appropriate responses',
    implementation: 'src/main/llm/',
    status: 'active',
  },
  {
    name: 'Tool Calling',
    description: 'Use tools to perform actions based on requests',
    implementation: 'src/main/agent/llm-tools.ts',
    status: 'active',
  },
  {
    name: 'Personality Expression',
    description: 'Express consistent personality in responses',
    implementation: 'src/main/agent/personality-manager.ts',
    status: 'active',
  },

  // Agent Capabilities
  {
    name: 'File Operations',
    description: 'Read, write, search files on the system',
    implementation: 'src/main/agent/tools/',
    status: 'active',
  },
  {
    name: 'Terminal Execution',
    description: 'Run shell commands safely',
    implementation: 'src/main/agent/tools/',
    status: 'active',
  },
  {
    name: 'App Launching',
    description: 'Open applications by name',
    implementation: 'src/main/agent/tools/',
    status: 'active',
  },
  {
    name: 'Web Search',
    description: 'Search the internet for information',
    implementation: 'src/main/agent/tools/',
    status: 'active',
  },
  {
    name: 'Screenshot Capture',
    description: 'Take screenshots of the screen',
    implementation: 'src/main/agent/tools/',
    status: 'active',
  },
  {
    name: 'Clipboard Access',
    description: 'Read and write clipboard content',
    implementation: 'src/main/agent/tools/',
    status: 'active',
  },
  {
    name: 'Task Management',
    description: 'Plan and execute multi-step tasks',
    implementation: 'src/main/agent/task-framework.ts',
    status: 'active',
  },

  // Memory & Context
  {
    name: 'Conversation Memory',
    description: 'Remember conversation history',
    implementation: 'src/main/memory/',
    status: 'active',
  },
  {
    name: 'Semantic Search',
    description: 'Search memories by meaning',
    implementation: 'src/main/memory/',
    status: 'partial',
  },
  {
    name: 'Long-term Memory',
    description: 'Persist important information across sessions',
    implementation: 'src/main/memory/',
    status: 'planned',
  },

  // Integrations
  {
    name: 'Spotify Control',
    description: 'Control Spotify playback',
    implementation: 'src/main/integrations/spotify.ts',
    status: 'partial',
  },
  {
    name: 'Calendar Access',
    description: 'Read and manage calendar events',
    implementation: 'src/main/integrations/calendar.ts',
    status: 'partial',
  },
  {
    name: 'Email Integration',
    description: 'Read and send emails',
    implementation: 'src/main/integrations/email.ts',
    status: 'partial',
  },
  {
    name: 'Banking Integration',
    description: 'Access financial data via TrueLayer',
    implementation: 'src/main/finance/',
    status: 'partial',
  },

  // Visual
  {
    name: 'Particle Orb Display',
    description: '3D animated orb visualization',
    implementation: 'src/renderer/components/orb/',
    status: 'active',
  },
  {
    name: 'State Animations',
    description: 'Visual feedback for different states',
    implementation: 'src/renderer/components/orb/',
    status: 'active',
  },

  // Security
  {
    name: 'Permission Management',
    description: 'Control access to sensitive operations',
    implementation: 'src/main/security/permissions.ts',
    status: 'active',
  },
  {
    name: 'Input Validation',
    description: 'Validate and sanitize all inputs',
    implementation: 'src/main/security/input-validator.ts',
    status: 'active',
  },
  {
    name: 'Audit Logging',
    description: 'Log all sensitive operations',
    implementation: 'src/main/security/audit-logger.ts',
    status: 'active',
  },

  // Self-Improvement
  {
    name: 'Self Awareness',
    description: 'Understand own codebase and capabilities',
    implementation: 'src/main/agent/self-awareness.ts',
    status: 'active',
  },
  {
    name: 'GEPA Self-Modification',
    description: 'Guided evolutionary prompt architecture',
    implementation: 'src/main/gepa/',
    status: 'partial',
  },
];

// ============================================================================
// Self Awareness Manager Implementation
// ============================================================================

class SelfAwarenessManager implements SelfAwareness {
  private index: CodebaseIndex | null = null;
  private projectRoot: string;
  private indexCachePath: string;
  private isIndexing = false;

  constructor() {
    // Determine project root (go up from src/main/agent)
    this.projectRoot = path.resolve(__dirname, '..', '..', '..');
    this.indexCachePath = path.join(this.projectRoot, '.atlas-cache', 'codebase-index.json');
    logger.info('SelfAwareness initialized', { projectRoot: this.projectRoot });
  }

  /**
   * Initialize the self-awareness system
   */
  async initialize(): Promise<void> {
    logger.info('Initializing self-awareness system');
    await this.loadOrBuildIndex();
  }

  /**
   * Load cached index or build fresh one
   */
  private async loadOrBuildIndex(): Promise<void> {
    if (this.isIndexing) {
      logger.debug('Index already in progress, skipping');
      return;
    }

    try {
      // Try to load cached index
      if (fs.existsSync(this.indexCachePath)) {
        const cached = JSON.parse(fs.readFileSync(this.indexCachePath, 'utf-8'));
        const cacheAge = Date.now() - cached.lastIndexed;
        const oneHour = 60 * 60 * 1000;

        // Use cache if less than 1 hour old
        if (cacheAge < oneHour) {
          this.index = {
            files: new Map(Object.entries(cached.files)),
            lastIndexed: cached.lastIndexed,
            projectRoot: cached.projectRoot,
          };
          logger.info('Loaded cached codebase index', {
            fileCount: this.index.files.size,
            cacheAge: Math.round(cacheAge / 1000) + 's',
          });
          return;
        }
      }
    } catch (error) {
      logger.debug('Failed to load cached index, will rebuild', {
        error: (error as Error).message,
      });
    }

    // Build fresh index
    await this.rebuildIndex();
  }

  /**
   * Rebuild the codebase index
   */
  async rebuildIndex(): Promise<void> {
    if (this.isIndexing) {
      logger.debug('Index already in progress');
      return;
    }

    this.isIndexing = true;
    const startTime = Date.now();
    logger.info('Building codebase index');

    try {
      const files = new Map<string, FileIndex>();
      const srcDir = path.join(this.projectRoot, 'src');

      if (fs.existsSync(srcDir)) {
        await this.indexDirectory(srcDir, files);
      }

      this.index = {
        files,
        lastIndexed: Date.now(),
        projectRoot: this.projectRoot,
      };

      // Save cache
      await this.saveIndexCache();

      const duration = Date.now() - startTime;
      logger.info('Codebase index built', {
        fileCount: files.size,
        duration: duration + 'ms',
      });
    } catch (error) {
      logger.error('Failed to build codebase index', { error: (error as Error).message });
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Recursively index a directory
   */
  private async indexDirectory(dir: string, files: Map<string, FileIndex>): Promise<void> {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules, dist, etc.
        if (!['node_modules', 'dist', '.git', 'coverage', '.atlas-cache'].includes(entry.name)) {
          await this.indexDirectory(fullPath, files);
        }
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        const fileIndex = await this.indexFile(fullPath);
        if (fileIndex) {
          files.set(fileIndex.relativePath, fileIndex);
        }
      }
    }
  }

  /**
   * Index a single TypeScript file
   */
  private async indexFile(filePath: string): Promise<FileIndex | null> {
    try {
      const stats = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(this.projectRoot, filePath).replace(/\\/g, '/');

      // Extract code elements using regex patterns
      const exports = this.extractExports(content);
      const imports = this.extractImports(content);
      const classes = this.extractClasses(content);
      const functions = this.extractFunctions(content);
      const interfaces = this.extractInterfaces(content);

      return {
        path: filePath,
        relativePath,
        name: path.basename(filePath, path.extname(filePath)),
        modifiedTime: stats.mtimeMs,
        exports,
        imports,
        classes,
        functions,
        interfaces,
      };
    } catch (error) {
      logger.debug('Failed to index file', { filePath, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Extract export statements from file content
   */
  private extractExports(content: string): string[] {
    const exports: string[] = [];

    // export const/let/var/function/class/interface/type
    const namedExportRegex =
      /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
    let match;
    while ((match = namedExportRegex.exec(content)) !== null) {
      exports.push(match[1]);
    }

    // export { name }
    const bracketExportRegex = /export\s*\{([^}]+)\}/g;
    while ((match = bracketExportRegex.exec(content)) !== null) {
      const names = match[1].split(',').map((n) =>
        n
          .trim()
          .split(/\s+as\s+/)[0]
          .trim()
      );
      exports.push(...names.filter((n) => n && n !== ''));
    }

    // export default
    const defaultExportRegex = /export\s+default\s+(?:class|function)?\s*(\w+)?/g;
    while ((match = defaultExportRegex.exec(content)) !== null) {
      if (match[1]) {
        exports.push('default:' + match[1]);
      } else {
        exports.push('default');
      }
    }

    return Array.from(new Set(exports));
  }

  /**
   * Extract import statements from file content
   */
  private extractImports(content: string): string[] {
    const imports: string[] = [];
    const importRegex = /import\s+(?:(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }
    return Array.from(new Set(imports));
  }

  /**
   * Extract class declarations from file content
   */
  private extractClasses(content: string): string[] {
    const classes: string[] = [];
    const classRegex = /class\s+(\w+)/g;
    let match;
    while ((match = classRegex.exec(content)) !== null) {
      classes.push(match[1]);
    }
    return Array.from(new Set(classes));
  }

  /**
   * Extract function declarations from file content
   */
  private extractFunctions(content: string): string[] {
    const functions: string[] = [];

    // function declarations
    const funcRegex = /(?:async\s+)?function\s+(\w+)/g;
    let match;
    while ((match = funcRegex.exec(content)) !== null) {
      functions.push(match[1]);
    }

    // arrow function assignments (const foo = () => or const foo = async () =>)
    const arrowRegex =
      /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/g;
    while ((match = arrowRegex.exec(content)) !== null) {
      functions.push(match[1]);
    }

    return Array.from(new Set(functions));
  }

  /**
   * Extract interface declarations from file content
   */
  private extractInterfaces(content: string): string[] {
    const interfaces: string[] = [];
    const interfaceRegex = /interface\s+(\w+)/g;
    let match;
    while ((match = interfaceRegex.exec(content)) !== null) {
      interfaces.push(match[1]);
    }

    // Also get type aliases
    const typeRegex = /type\s+(\w+)\s*=/g;
    while ((match = typeRegex.exec(content)) !== null) {
      interfaces.push(match[1]);
    }

    return Array.from(new Set(interfaces));
  }

  /**
   * Save index to cache file
   */
  private async saveIndexCache(): Promise<void> {
    if (!this.index) return;

    try {
      const cacheDir = path.dirname(this.indexCachePath);
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      const cacheData = {
        files: Object.fromEntries(this.index.files),
        lastIndexed: this.index.lastIndexed,
        projectRoot: this.index.projectRoot,
      };

      fs.writeFileSync(this.indexCachePath, JSON.stringify(cacheData, null, 2));
      logger.debug('Saved codebase index cache');
    } catch (error) {
      logger.warn('Failed to save index cache', { error: (error as Error).message });
    }
  }

  /**
   * Get all source files
   */
  getOwnSourceFiles(): string[] {
    if (!this.index) {
      return [];
    }
    return Array.from(this.index.files.keys()).sort();
  }

  /**
   * Get architecture map
   */
  getArchitectureMap(): ArchitectureMap {
    const mainProcess: ModuleInfo[] = [];
    const renderer: ModuleInfo[] = [];
    const shared: ModuleInfo[] = [];
    const entryPoints = ['src/main/index.ts', 'src/renderer/App.tsx'];

    if (!this.index) {
      return { mainProcess, renderer, shared, entryPoints };
    }

    // Group files by directory
    const dirGroups = new Map<string, FileIndex[]>();

    const fileEntries = Array.from(this.index.files.entries());
    for (let i = 0; i < fileEntries.length; i++) {
      const [relativePath, fileIndex] = fileEntries[i];
      const parts = relativePath.split('/');
      if (parts[0] !== 'src') continue;

      const category = parts[1]; // main, renderer, or shared
      const moduleName = parts[2]; // voice, stt, components, etc.

      if (!moduleName) continue;

      const key = `${category}/${moduleName}`;
      if (!dirGroups.has(key)) {
        dirGroups.set(key, []);
      }
      dirGroups.get(key)!.push(fileIndex);
    }

    // Build module info for each group
    const groupEntries = Array.from(dirGroups.entries());
    for (let i = 0; i < groupEntries.length; i++) {
      const [key, files] = groupEntries[i];
      const [category, moduleName] = key.split('/');

      // Aggregate exports and dependencies
      const allExports: string[] = [];
      const allDependencies: string[] = [];

      for (const file of files) {
        allExports.push(...file.exports);
        allDependencies.push(...file.imports.filter((i) => !i.startsWith('.')));
      }

      const moduleInfo: ModuleInfo = {
        path: `src/${category}/${moduleName}`,
        name: moduleName,
        description: this.getModuleDescription(moduleName, category),
        exports: Array.from(new Set(allExports)).slice(0, 20), // Limit to top 20
        dependencies: Array.from(new Set(allDependencies)).slice(0, 15), // Limit external deps
      };

      switch (category) {
        case 'main':
          mainProcess.push(moduleInfo);
          break;
        case 'renderer':
          renderer.push(moduleInfo);
          break;
        case 'shared':
          shared.push(moduleInfo);
          break;
      }
    }

    return {
      mainProcess: mainProcess.sort((a, b) => a.name.localeCompare(b.name)),
      renderer: renderer.sort((a, b) => a.name.localeCompare(b.name)),
      shared: shared.sort((a, b) => a.name.localeCompare(b.name)),
      entryPoints,
    };
  }

  /**
   * Get description for a module
   */
  private getModuleDescription(moduleName: string, category: string): string {
    // Check for specific path match first
    const specificKey = `${category === 'renderer' ? '' : ''}${moduleName}`;
    if (MODULE_DESCRIPTIONS[specificKey]) {
      return MODULE_DESCRIPTIONS[specificKey];
    }

    // Check for renderer component paths
    if (category === 'renderer' && moduleName.startsWith('components')) {
      const compKey = moduleName.replace('components/', 'components/');
      if (MODULE_DESCRIPTIONS[compKey]) {
        return MODULE_DESCRIPTIONS[compKey];
      }
    }

    // Fallback to generic module name
    if (MODULE_DESCRIPTIONS[moduleName]) {
      return MODULE_DESCRIPTIONS[moduleName];
    }

    return `${moduleName} module`;
  }

  /**
   * Get all capabilities
   */
  getCapabilities(): Capability[] {
    return [...CAPABILITY_DEFINITIONS];
  }

  /**
   * Get known limitations
   */
  getLimitations(): string[] {
    return [...KNOWN_LIMITATIONS];
  }

  /**
   * Explain how a feature works
   */
  explainFeature(featureName: string): string {
    // Normalize the feature name for lookup
    const normalized = featureName.toLowerCase().replace(/[\s_]+/g, '-');

    // Direct match
    if (FEATURE_EXPLANATIONS[normalized]) {
      return FEATURE_EXPLANATIONS[normalized];
    }

    // Partial match
    for (const [key, explanation] of Object.entries(FEATURE_EXPLANATIONS)) {
      if (key.includes(normalized) || normalized.includes(key)) {
        return explanation;
      }
    }

    // Search capabilities for match
    const capability = CAPABILITY_DEFINITIONS.find(
      (c) =>
        c.name.toLowerCase().includes(normalized) ||
        normalized.includes(c.name.toLowerCase().replace(/\s+/g, '-'))
    );

    if (capability) {
      return (
        `${capability.name}: ${capability.description}\n` +
        `Implementation: ${capability.implementation}\n` +
        `Status: ${capability.status}`
      );
    }

    // Generate explanation from index if possible
    const locations = this.findImplementation(featureName);
    if (locations.length > 0) {
      const fileList = locations
        .slice(0, 5)
        .map((l) => `- ${l.file}: ${l.description}`)
        .join('\n');
      return `Feature "${featureName}" appears to be implemented in:\n${fileList}`;
    }

    return (
      `I don't have detailed information about "${featureName}". ` +
      `Try asking about: ${Object.keys(FEATURE_EXPLANATIONS).slice(0, 5).join(', ')}, etc.`
    );
  }

  /**
   * Find where a concept is implemented
   */
  findImplementation(concept: string): FileLocation[] {
    const locations: FileLocation[] = [];
    const searchTerms = concept.toLowerCase().split(/[\s_-]+/);

    if (!this.index) {
      return locations;
    }

    const fileEntries = Array.from(this.index.files.entries());
    for (let i = 0; i < fileEntries.length; i++) {
      const [relativePath, fileIndex] = fileEntries[i];
      let matchScore = 0;
      let description = '';

      // Check file name
      const fileName = fileIndex.name.toLowerCase();
      for (const term of searchTerms) {
        if (fileName.includes(term)) {
          matchScore += 3;
          description = `File name matches "${term}"`;
        }
      }

      // Check path components
      const pathParts = relativePath.toLowerCase();
      for (const term of searchTerms) {
        if (pathParts.includes(term)) {
          matchScore += 2;
          if (!description) description = `Path contains "${term}"`;
        }
      }

      // Check exports
      for (const exp of fileIndex.exports) {
        const expLower = exp.toLowerCase();
        for (const term of searchTerms) {
          if (expLower.includes(term)) {
            matchScore += 2;
            description = `Exports "${exp}"`;
            break;
          }
        }
      }

      // Check classes
      for (const cls of fileIndex.classes) {
        const clsLower = cls.toLowerCase();
        for (const term of searchTerms) {
          if (clsLower.includes(term)) {
            matchScore += 2;
            description = `Contains class "${cls}"`;
            break;
          }
        }
      }

      // Check functions
      for (const func of fileIndex.functions) {
        const funcLower = func.toLowerCase();
        for (const term of searchTerms) {
          if (funcLower.includes(term)) {
            matchScore += 1;
            if (!description) description = `Contains function "${func}"`;
            break;
          }
        }
      }

      // Check interfaces
      for (const iface of fileIndex.interfaces) {
        const ifaceLower = iface.toLowerCase();
        for (const term of searchTerms) {
          if (ifaceLower.includes(term)) {
            matchScore += 1;
            if (!description) description = `Defines interface "${iface}"`;
            break;
          }
        }
      }

      if (matchScore > 0) {
        locations.push({
          file: relativePath,
          description: description || `Matches search for "${concept}"`,
        });
      }
    }

    // Sort by relevance and limit results
    return locations
      .sort((a, b) => {
        // Prioritize exact matches and main implementation files
        const aScore = this.calculateRelevanceScore(a.file, searchTerms);
        const bScore = this.calculateRelevanceScore(b.file, searchTerms);
        return bScore - aScore;
      })
      .slice(0, 10);
  }

  /**
   * Calculate relevance score for sorting results
   */
  private calculateRelevanceScore(filePath: string, searchTerms: string[]): number {
    let score = 0;
    const pathLower = filePath.toLowerCase();

    // Boost for exact term in filename
    const fileName = path.basename(filePath).toLowerCase();
    for (const term of searchTerms) {
      if (fileName.includes(term)) score += 10;
      if (fileName === term + '.ts' || fileName === term + '.tsx') score += 20;
    }

    // Boost for index files (main entry points)
    if (fileName === 'index.ts') score += 5;

    // Boost for main process files
    if (pathLower.includes('src/main/')) score += 2;

    // Slight penalty for test files
    if (pathLower.includes('.test.') || pathLower.includes('.spec.')) score -= 5;

    return score;
  }

  /**
   * Answer meta-questions about Atlas itself
   */
  answerSelfQuery(query: string): string {
    const queryLower = query.toLowerCase();

    // "How do you work?"
    if (
      queryLower.includes('how') &&
      (queryLower.includes('work') || queryLower.includes('function'))
    ) {
      return `I'm Atlas, a voice-first desktop AI assistant. Here's how I work:

1. **Wake Word Detection**: I listen for "Hey Atlas" using Porcupine
2. **Voice Activity Detection**: Silero VAD determines when you're speaking
3. **Speech Recognition**: Deepgram converts your speech to text in real-time
4. **Language Understanding**: Fireworks AI (DeepSeek V3.1) processes your request
5. **Tool Execution**: I can use various tools to help you (files, apps, search, etc.)
6. **Text to Speech**: ElevenLabs converts my response to natural speech

My codebase is organized into:
- Main process (Electron): Voice pipeline, LLM, tools, security
- Renderer process (React): Visual orb, UI components
- Shared: TypeScript types

I have ${this.getOwnSourceFiles().length} source files implementing ${this.getCapabilities().length} capabilities.`;
    }

    // "What can you do?"
    if (
      queryLower.includes('what') &&
      (queryLower.includes('can') || queryLower.includes('able'))
    ) {
      const activeCapabilities = this.getCapabilities().filter((c) => c.status === 'active');
      const capList = activeCapabilities
        .slice(0, 10)
        .map((c) => `- ${c.name}: ${c.description}`)
        .join('\n');
      return `I have ${activeCapabilities.length} active capabilities:\n\n${capList}\n\n...and more! Ask about specific features for details.`;
    }

    // "What are your limitations?"
    if (
      queryLower.includes('limitation') ||
      queryLower.includes('cannot') ||
      queryLower.includes("can't")
    ) {
      const limits = this.getLimitations()
        .slice(0, 7)
        .map((l) => `- ${l}`)
        .join('\n');
      return `Here are some of my limitations:\n\n${limits}`;
    }

    // "Where is X implemented?"
    const whereMatch = queryLower.match(
      /where\s+is\s+(.+?)(?:\s+implemented|\s+defined|\s+located|$|\?)/
    );
    if (whereMatch) {
      const concept = whereMatch[1].trim();
      const locations = this.findImplementation(concept);
      if (locations.length > 0) {
        const locList = locations
          .slice(0, 5)
          .map((l) => `- ${l.file}: ${l.description}`)
          .join('\n');
        return `"${concept}" is implemented in:\n\n${locList}`;
      }
      return `I couldn't find a specific implementation for "${concept}".`;
    }

    // "How does X work?" or "Explain X"
    const explainMatch = queryLower.match(
      /(?:how\s+does|explain|describe)\s+(.+?)(?:\s+work|$|\?)/
    );
    if (explainMatch) {
      return this.explainFeature(explainMatch[1].trim());
    }

    // Default: try to explain as a feature
    return this.explainFeature(query);
  }

  /**
   * Get a summary of the codebase
   */
  getCodebaseSummary(): string {
    const files = this.getOwnSourceFiles();
    const arch = this.getArchitectureMap();
    const caps = this.getCapabilities();

    const activeCount = caps.filter((c) => c.status === 'active').length;
    const partialCount = caps.filter((c) => c.status === 'partial').length;

    return `Atlas Desktop Codebase Summary:

Files: ${files.length} TypeScript source files
Architecture:
- Main Process: ${arch.mainProcess.length} modules
- Renderer: ${arch.renderer.length} modules  
- Shared Types: ${arch.shared.length} modules
- Entry Points: ${arch.entryPoints.join(', ')}

Capabilities: ${caps.length} total
- Active: ${activeCount}
- Partial: ${partialCount}
- Planned: ${caps.length - activeCount - partialCount}

Key Technologies:
- Runtime: Electron 28+
- Frontend: React 18 + TypeScript 5
- 3D Graphics: React Three Fiber + Three.js
- State: Zustand
- Build: Vite + electron-builder

Last indexed: ${this.index ? new Date(this.index.lastIndexed).toLocaleString() : 'Not indexed'}`;
  }

  /**
   * Refresh the index (force rebuild)
   */
  async refresh(): Promise<void> {
    logger.info('Forcing codebase index refresh');
    await this.rebuildIndex();
  }

  /**
   * Check if a specific file has changed and needs re-indexing
   */
  async checkFileChanged(filePath: string): Promise<boolean> {
    if (!this.index) return true;

    const relativePath = path.relative(this.projectRoot, filePath).replace(/\\/g, '/');
    const cached = this.index.files.get(relativePath);

    if (!cached) return true;

    try {
      const stats = fs.statSync(filePath);
      return stats.mtimeMs > cached.modifiedTime;
    } catch {
      return true;
    }
  }

  /**
   * Update index for a specific file
   */
  async updateFile(filePath: string): Promise<void> {
    if (!this.index) {
      await this.rebuildIndex();
      return;
    }

    const fileIndex = await this.indexFile(filePath);
    if (fileIndex) {
      this.index.files.set(fileIndex.relativePath, fileIndex);
      this.index.lastIndexed = Date.now();
      await this.saveIndexCache();
      logger.debug('Updated index for file', { file: fileIndex.relativePath });
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let instance: SelfAwarenessManager | null = null;

/**
 * Get the self-awareness manager singleton
 */
export function getSelfAwareness(): SelfAwarenessManager {
  if (!instance) {
    instance = new SelfAwarenessManager();
  }
  return instance;
}

/**
 * Initialize self-awareness system (call on startup)
 */
export async function initializeSelfAwareness(): Promise<SelfAwarenessManager> {
  const manager = getSelfAwareness();
  await manager.initialize();
  return manager;
}

export default {
  getSelfAwareness,
  initializeSelfAwareness,
};
