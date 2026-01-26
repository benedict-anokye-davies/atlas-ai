/**
 * Atlas - Project Rules Manager
 *
 * Loads and parses .atlas-rules files from workspace directories.
 * Rules are injected into the LLM system prompt to enforce project-specific
 * coding standards, patterns, and constraints.
 *
 * Inspired by Cursor AI's .cursorrules system.
 *
 * @module agent/project-rules
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('ProjectRules');

// =============================================================================
// Types
// =============================================================================

/**
 * Parsed project rules structure
 */
export interface ProjectRules {
  /** Project name/title from the rules file */
  projectName?: string;
  /** Brief project description */
  description?: string;
  /** Code style guidelines */
  codeStyle: string[];
  /** Architecture patterns and principles */
  architecture: string[];
  /** Preferred patterns and best practices */
  patterns: string[];
  /** Things to avoid / never do */
  donts: string[];
  /** Additional context about the project */
  context: string[];
  /** Technology stack and versions */
  stack: string[];
  /** Testing requirements and patterns */
  testing: string[];
  /** Security guidelines */
  security: string[];
  /** Custom sections (key -> content array) */
  custom: Map<string, string[]>;
  /** Raw file content for reference */
  rawContent: string;
  /** File path where rules were loaded from */
  filePath: string;
  /** Last modified timestamp */
  lastModified: number;
}

/**
 * Project rules manager configuration
 */
export interface ProjectRulesConfig {
  /** File names to look for (in order of priority) */
  ruleFileNames: string[];
  /** Whether to watch for file changes */
  watchForChanges: boolean;
  /** Maximum rules file size in bytes (default: 64KB) */
  maxFileSize: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: ProjectRulesConfig = {
  ruleFileNames: ['.atlas-rules', '.atlas-rules.md', 'atlas-rules.md', '.cursorrules'],
  watchForChanges: true,
  maxFileSize: 64 * 1024, // 64KB
};

// =============================================================================
// Section Headers (case-insensitive matching)
// =============================================================================

const SECTION_PATTERNS: Record<string, keyof Omit<ProjectRules, 'custom' | 'rawContent' | 'filePath' | 'lastModified' | 'projectName' | 'description'>> = {
  'code style': 'codeStyle',
  'coding style': 'codeStyle',
  'style': 'codeStyle',
  'architecture': 'architecture',
  'patterns': 'patterns',
  'best practices': 'patterns',
  'preferred patterns': 'patterns',
  'don\'t': 'donts',
  'donts': 'donts',
  'never': 'donts',
  'avoid': 'donts',
  'forbidden': 'donts',
  'context': 'context',
  'project context': 'context',
  'about': 'context',
  'stack': 'stack',
  'tech stack': 'stack',
  'technology': 'stack',
  'technologies': 'stack',
  'testing': 'testing',
  'tests': 'testing',
  'test patterns': 'testing',
  'security': 'security',
  'security guidelines': 'security',
};

// =============================================================================
// Parser
// =============================================================================

/**
 * Parse a rules file content into structured ProjectRules
 */
function parseRulesFile(content: string, filePath: string): ProjectRules {
  const rules: ProjectRules = {
    codeStyle: [],
    architecture: [],
    patterns: [],
    donts: [],
    context: [],
    stack: [],
    testing: [],
    security: [],
    custom: new Map(),
    rawContent: content,
    filePath,
    lastModified: Date.now(),
  };

  const lines = content.split('\n');
  let currentSection: string | null = null;
  let currentSectionKey: keyof Omit<ProjectRules, 'custom' | 'rawContent' | 'filePath' | 'lastModified' | 'projectName' | 'description'> | null = null;
  let customSectionName: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines
    if (!trimmed) continue;
    
    // Check for h1 header (project name)
    if (trimmed.startsWith('# ') && !rules.projectName) {
      rules.projectName = trimmed.substring(2).trim();
      continue;
    }
    
    // Check for h2 headers (sections)
    if (trimmed.startsWith('## ')) {
      const sectionTitle = trimmed.substring(3).trim().toLowerCase();
      
      // Check if it's a known section
      const matchedKey = Object.entries(SECTION_PATTERNS).find(
        ([pattern]) => sectionTitle.includes(pattern)
      );
      
      if (matchedKey) {
        currentSection = matchedKey[0];
        currentSectionKey = matchedKey[1];
        customSectionName = null;
      } else {
        // Custom section
        currentSection = sectionTitle;
        currentSectionKey = null;
        customSectionName = trimmed.substring(3).trim(); // Keep original case
        rules.custom.set(customSectionName, []);
      }
      continue;
    }
    
    // Check for h3 headers (subsections - treat as custom)
    if (trimmed.startsWith('### ')) {
      const subsectionTitle = trimmed.substring(4).trim();
      customSectionName = subsectionTitle;
      rules.custom.set(customSectionName, []);
      currentSectionKey = null;
      continue;
    }
    
    // Check for description (first paragraph after project name)
    if (rules.projectName && !rules.description && !currentSection && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
      rules.description = trimmed;
      continue;
    }
    
    // Extract content from list items or plain text
    let content = trimmed;
    if (content.startsWith('- ')) {
      content = content.substring(2);
    } else if (content.startsWith('* ')) {
      content = content.substring(2);
    } else if (/^\d+\.\s/.test(content)) {
      content = content.replace(/^\d+\.\s/, '');
    }
    
    // Skip markdown artifacts
    if (content.startsWith('#') || content === '---' || content === '```') {
      continue;
    }
    
    // Add to appropriate section
    if (currentSectionKey && content) {
      rules[currentSectionKey].push(content);
    } else if (customSectionName && content) {
      const customContent = rules.custom.get(customSectionName) || [];
      customContent.push(content);
      rules.custom.set(customSectionName, customContent);
    }
  }

  return rules;
}

/**
 * Format rules into a prompt-friendly string
 */
function formatRulesForPrompt(rules: ProjectRules): string {
  const sections: string[] = [];
  
  if (rules.projectName) {
    sections.push(`Project: ${rules.projectName}`);
  }
  
  if (rules.description) {
    sections.push(rules.description);
  }
  
  if (rules.context.length > 0) {
    sections.push(`Context:\n${rules.context.map(c => `- ${c}`).join('\n')}`);
  }
  
  if (rules.stack.length > 0) {
    sections.push(`Stack: ${rules.stack.join(', ')}`);
  }
  
  if (rules.codeStyle.length > 0) {
    sections.push(`Code Style:\n${rules.codeStyle.map(s => `- ${s}`).join('\n')}`);
  }
  
  if (rules.architecture.length > 0) {
    sections.push(`Architecture:\n${rules.architecture.map(a => `- ${a}`).join('\n')}`);
  }
  
  if (rules.patterns.length > 0) {
    sections.push(`Patterns:\n${rules.patterns.map(p => `- ${p}`).join('\n')}`);
  }
  
  if (rules.donts.length > 0) {
    sections.push(`Never:\n${rules.donts.map(d => `- ${d}`).join('\n')}`);
  }
  
  if (rules.testing.length > 0) {
    sections.push(`Testing:\n${rules.testing.map(t => `- ${t}`).join('\n')}`);
  }
  
  if (rules.security.length > 0) {
    sections.push(`Security:\n${rules.security.map(s => `- ${s}`).join('\n')}`);
  }
  
  // Add custom sections
  for (const [name, content] of rules.custom) {
    if (content.length > 0) {
      sections.push(`${name}:\n${content.map(c => `- ${c}`).join('\n')}`);
    }
  }
  
  return sections.join('\n\n');
}

// =============================================================================
// Project Rules Manager
// =============================================================================

/**
 * Manages loading, caching, and watching project rules files
 */
export class ProjectRulesManager extends EventEmitter {
  private config: ProjectRulesConfig;
  private cache: Map<string, ProjectRules> = new Map();
  private watchers: Map<string, fs.FSWatcher> = new Map();

  constructor(config: Partial<ProjectRulesConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('ProjectRulesManager initialized', { config: this.config });
  }

  /**
   * Load rules for a workspace directory
   */
  async loadRules(workspacePath: string): Promise<ProjectRules | null> {
    // Check cache first
    const cached = this.cache.get(workspacePath);
    if (cached) {
      // Check if file still exists and hasn't changed
      try {
        const stat = fs.statSync(cached.filePath);
        if (stat.mtimeMs <= cached.lastModified) {
          return cached;
        }
      } catch {
        // File deleted, clear cache
        this.cache.delete(workspacePath);
      }
    }

    // Try to find rules file
    for (const fileName of this.config.ruleFileNames) {
      const filePath = path.join(workspacePath, fileName);
      
      try {
        const stat = fs.statSync(filePath);
        
        // Check file size
        if (stat.size > this.config.maxFileSize) {
          logger.warn('Rules file too large, skipping', { filePath, size: stat.size });
          continue;
        }
        
        // Read and parse
        const content = fs.readFileSync(filePath, 'utf-8');
        const rules = parseRulesFile(content, filePath);
        
        // Cache
        this.cache.set(workspacePath, rules);
        
        // Set up watcher if enabled
        if (this.config.watchForChanges) {
          this.watchFile(workspacePath, filePath);
        }
        
        logger.info('Loaded project rules', {
          filePath,
          projectName: rules.projectName,
          sections: {
            codeStyle: rules.codeStyle.length,
            architecture: rules.architecture.length,
            patterns: rules.patterns.length,
            donts: rules.donts.length,
          },
        });
        
        return rules;
      } catch (error) {
        // File doesn't exist or can't be read, try next
        continue;
      }
    }
    
    logger.debug('No rules file found', { workspacePath });
    return null;
  }

  /**
   * Get formatted rules string for LLM prompt injection
   */
  async getRulesForPrompt(workspacePath: string): Promise<string | null> {
    const rules = await this.loadRules(workspacePath);
    if (!rules) return null;
    
    return `[PROJECT RULES]\n${formatRulesForPrompt(rules)}`;
  }

  /**
   * Inject rules into system prompt
   */
  injectIntoPrompt(systemPrompt: string, rules: ProjectRules | null): string {
    if (!rules) return systemPrompt;
    
    const rulesBlock = `\n\n[PROJECT RULES]\n${formatRulesForPrompt(rules)}`;
    return systemPrompt + rulesBlock;
  }

  /**
   * Get cached rules for a workspace
   */
  getCachedRules(workspacePath: string): ProjectRules | null {
    return this.cache.get(workspacePath) || null;
  }

  /**
   * Clear cached rules for a workspace
   */
  clearCache(workspacePath?: string): void {
    if (workspacePath) {
      this.cache.delete(workspacePath);
      const watcher = this.watchers.get(workspacePath);
      if (watcher) {
        watcher.close();
        this.watchers.delete(workspacePath);
      }
    } else {
      this.cache.clear();
      for (const watcher of this.watchers.values()) {
        watcher.close();
      }
      this.watchers.clear();
    }
  }

  /**
   * Set up file watcher for rules file
   */
  private watchFile(workspacePath: string, filePath: string): void {
    // Clean up existing watcher
    const existing = this.watchers.get(workspacePath);
    if (existing) {
      existing.close();
    }

    try {
      const watcher = fs.watch(filePath, (eventType) => {
        if (eventType === 'change') {
          logger.info('Rules file changed, reloading', { filePath });
          this.cache.delete(workspacePath);
          
          // Reload and emit event
          this.loadRules(workspacePath).then((rules) => {
            if (rules) {
              this.emit('rules-changed', workspacePath, rules);
            }
          });
        } else if (eventType === 'rename') {
          // File might have been deleted
          logger.info('Rules file renamed/deleted', { filePath });
          this.cache.delete(workspacePath);
          this.emit('rules-removed', workspacePath);
        }
      });

      this.watchers.set(workspacePath, watcher);
    } catch (error) {
      logger.warn('Failed to watch rules file', { filePath, error: (error as Error).message });
    }
  }

  /**
   * Create a new rules file for a workspace
   */
  async createRulesFile(workspacePath: string, initialRules?: Partial<ProjectRules>): Promise<string> {
    const filePath = path.join(workspacePath, '.atlas-rules');
    
    const content = this.generateRulesTemplate(initialRules);
    fs.writeFileSync(filePath, content, 'utf-8');
    
    logger.info('Created rules file', { filePath });
    
    // Load into cache
    await this.loadRules(workspacePath);
    
    return filePath;
  }

  /**
   * Generate a rules file template
   */
  private generateRulesTemplate(rules?: Partial<ProjectRules>): string {
    const sections: string[] = [];
    
    sections.push(`# ${rules?.projectName || 'Project Name'}`);
    sections.push('');
    sections.push(rules?.description || 'Brief project description.');
    sections.push('');
    
    sections.push('## Tech Stack');
    if (rules?.stack && rules.stack.length > 0) {
      sections.push(rules.stack.map(s => `- ${s}`).join('\n'));
    } else {
      sections.push('- TypeScript');
      sections.push('- Node.js');
    }
    sections.push('');
    
    sections.push('## Code Style');
    if (rules?.codeStyle && rules.codeStyle.length > 0) {
      sections.push(rules.codeStyle.map(s => `- ${s}`).join('\n'));
    } else {
      sections.push('- Use single quotes for strings');
      sections.push('- 2-space indentation');
      sections.push('- Prefer const over let');
    }
    sections.push('');
    
    sections.push('## Architecture');
    if (rules?.architecture && rules.architecture.length > 0) {
      sections.push(rules.architecture.map(a => `- ${a}`).join('\n'));
    } else {
      sections.push('- Describe your architecture patterns here');
    }
    sections.push('');
    
    sections.push('## Patterns');
    if (rules?.patterns && rules.patterns.length > 0) {
      sections.push(rules.patterns.map(p => `- ${p}`).join('\n'));
    } else {
      sections.push('- Use async/await over callbacks');
      sections.push('- Prefer composition over inheritance');
    }
    sections.push('');
    
    sections.push('## Never');
    if (rules?.donts && rules.donts.length > 0) {
      sections.push(rules.donts.map(d => `- ${d}`).join('\n'));
    } else {
      sections.push('- Never use any type without justification');
      sections.push('- Never commit secrets or API keys');
    }
    sections.push('');
    
    sections.push('## Testing');
    if (rules?.testing && rules.testing.length > 0) {
      sections.push(rules.testing.map(t => `- ${t}`).join('\n'));
    } else {
      sections.push('- Write tests for critical paths');
      sections.push('- Use descriptive test names');
    }
    sections.push('');
    
    sections.push('## Security');
    if (rules?.security && rules.security.length > 0) {
      sections.push(rules.security.map(s => `- ${s}`).join('\n'));
    } else {
      sections.push('- Validate all user inputs');
      sections.push('- Use parameterized queries');
    }
    
    return sections.join('\n');
  }

  /**
   * Shutdown manager and clean up watchers
   */
  shutdown(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    this.cache.clear();
    logger.info('ProjectRulesManager shutdown');
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: ProjectRulesManager | null = null;

/**
 * Get the project rules manager singleton
 */
export function getProjectRulesManager(): ProjectRulesManager {
  if (!instance) {
    instance = new ProjectRulesManager();
  }
  return instance;
}

export default ProjectRulesManager;
