/**
 * Atlas Desktop - Obsidian State Helper
 *
 * Provides consistent storage of Atlas internal state as human-readable markdown
 * files in the Obsidian vault. All state is stored with YAML frontmatter for
 * machine parsing and markdown content for human readability.
 *
 * @module memory/obsidian-state
 */

import * as fse from 'fs-extra';
import * as path from 'path';
import * as yaml from 'yaml';
import { createModuleLogger } from '../utils/logger';
import { getVaultPath } from './obsidian-brain';

const logger = createModuleLogger('ObsidianState');

// ============================================================================
// Types
// ============================================================================

/**
 * State file location within the vault
 */
export interface StateLocation {
  directory: string; // e.g., 'self', 'profile', 'daily'
  filename: string; // e.g., 'emotional-state.md', 'backstory.md'
}

/**
 * Base interface for state documents
 */
export interface StateDocument<T = Record<string, unknown>> {
  frontmatter: T;
  content: string;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get the full path to a state file
 */
export function getStatePath(location: StateLocation): string {
  const vaultPath = getVaultPath();
  return path.join(vaultPath, location.directory, location.filename);
}

/**
 * Parse a markdown file with YAML frontmatter
 */
export function parseStateFile<T = Record<string, unknown>>(raw: string): StateDocument<T> | null {
  try {
    // Check for frontmatter delimiter
    if (!raw.startsWith('---')) {
      return {
        frontmatter: {} as T,
        content: raw,
      };
    }

    // Find the end of frontmatter
    const endDelimiter = raw.indexOf('---', 3);
    if (endDelimiter === -1) {
      return {
        frontmatter: {} as T,
        content: raw,
      };
    }

    const frontmatterRaw = raw.slice(3, endDelimiter).trim();
    const content = raw.slice(endDelimiter + 3).trim();

    const frontmatter = yaml.parse(frontmatterRaw) as T;

    return {
      frontmatter,
      content,
    };
  } catch (error) {
    logger.warn('Failed to parse state file', { error: (error as Error).message });
    return null;
  }
}

/**
 * Serialize state to markdown with YAML frontmatter
 */
export function serializeStateFile<T = Record<string, unknown>>(doc: StateDocument<T>): string {
  const frontmatterStr = yaml.stringify(doc.frontmatter, {
    indent: 2,
    lineWidth: 0, // Don't wrap lines
  });

  return `---
${frontmatterStr.trim()}
---

${doc.content}`;
}

/**
 * Load state from an Obsidian markdown file
 *
 * @param location - Where the state file is located
 * @returns Parsed state document or null if not found
 */
export async function loadState<T = Record<string, unknown>>(
  location: StateLocation
): Promise<StateDocument<T> | null> {
  const filePath = getStatePath(location);

  try {
    if (!(await fse.pathExists(filePath))) {
      logger.debug('State file not found', { path: filePath });
      return null;
    }

    const raw = await fse.readFile(filePath, 'utf-8');
    const doc = parseStateFile<T>(raw);

    if (doc) {
      logger.debug('Loaded state', { path: filePath });
    }

    return doc;
  } catch (error) {
    logger.error('Failed to load state', {
      path: filePath,
      error: (error as Error).message,
    });
    return null;
  }
}

/**
 * Load state synchronously
 */
export function loadStateSync<T = Record<string, unknown>>(
  location: StateLocation
): StateDocument<T> | null {
  const filePath = getStatePath(location);

  try {
    if (!fse.pathExistsSync(filePath)) {
      logger.debug('State file not found', { path: filePath });
      return null;
    }

    const raw = fse.readFileSync(filePath, 'utf-8');
    const doc = parseStateFile<T>(raw);

    if (doc) {
      logger.debug('Loaded state', { path: filePath });
    }

    return doc;
  } catch (error) {
    logger.error('Failed to load state', {
      path: filePath,
      error: (error as Error).message,
    });
    return null;
  }
}

/**
 * Save state to an Obsidian markdown file
 *
 * @param location - Where to save the state
 * @param doc - The state document to save
 */
export async function saveState<T = Record<string, unknown>>(
  location: StateLocation,
  doc: StateDocument<T>
): Promise<boolean> {
  const filePath = getStatePath(location);
  const dirPath = path.dirname(filePath);

  try {
    // Ensure directory exists
    await fse.ensureDir(dirPath);

    // Serialize and write
    const content = serializeStateFile(doc);
    await fse.writeFile(filePath, content, 'utf-8');

    logger.debug('Saved state', { path: filePath });
    return true;
  } catch (error) {
    logger.error('Failed to save state', {
      path: filePath,
      error: (error as Error).message,
    });
    return false;
  }
}

/**
 * Save state synchronously
 */
export function saveStateSync<T = Record<string, unknown>>(
  location: StateLocation,
  doc: StateDocument<T>
): boolean {
  const filePath = getStatePath(location);
  const dirPath = path.dirname(filePath);

  try {
    // Ensure directory exists
    fse.ensureDirSync(dirPath);

    // Serialize and write
    const content = serializeStateFile(doc);
    fse.writeFileSync(filePath, content, 'utf-8');

    logger.debug('Saved state', { path: filePath });
    return true;
  } catch (error) {
    logger.error('Failed to save state', {
      path: filePath,
      error: (error as Error).message,
    });
    return false;
  }
}

// ============================================================================
// Pre-defined State Locations
// ============================================================================

/**
 * Standard locations for Atlas state files
 */
export const STATE_LOCATIONS = {
  /** Emotional state tracking */
  emotionalState: {
    directory: 'self',
    filename: 'emotional-state.md',
  } as StateLocation,

  /** Proactivity learning and preferences */
  proactivity: {
    directory: 'self',
    filename: 'proactivity.md',
  } as StateLocation,

  /** Atlas backstory and memory fragments */
  backstory: {
    directory: 'self',
    filename: 'backstory.md',
  } as StateLocation,

  /** Atlas personality configuration */
  personality: {
    directory: 'self',
    filename: 'personality.md',
  } as StateLocation,

  /** User profile and preferences */
  userProfile: {
    directory: 'profile',
    filename: 'user.md',
  } as StateLocation,

  /** Communication preferences */
  communication: {
    directory: 'profile',
    filename: 'communication.md',
  } as StateLocation,
};

// ============================================================================
// Markdown Content Generators
// ============================================================================

/**
 * Generate human-readable markdown for emotional state
 */
export function generateEmotionalStateContent(data: {
  currentMood: string;
  moodHistory: Array<{ emotion: string; timestamp: string; intensity: number }>;
  isStressedToday: boolean;
}): string {
  const lines: string[] = [
    '# Emotional State',
    '',
    `**Current Mood:** ${data.currentMood}`,
    `**Stressed Today:** ${data.isStressedToday ? 'Yes' : 'No'}`,
    '',
    '## Recent Mood History',
    '',
  ];

  if (data.moodHistory.length === 0) {
    lines.push('*No mood history recorded yet.*');
  } else {
    lines.push('| Time | Emotion | Intensity |');
    lines.push('|------|---------|-----------|');
    for (const entry of data.moodHistory.slice(-10)) {
      const time = new Date(entry.timestamp).toLocaleString();
      const intensity = entry.intensity < 0.4 ? 'Low' : entry.intensity < 0.7 ? 'Medium' : 'High';
      lines.push(`| ${time} | ${entry.emotion} | ${intensity} |`);
    }
  }

  lines.push('', '---', '*This file is managed by Atlas. Feel free to read but avoid editing.*');

  return lines.join('\n');
}

/**
 * Generate human-readable markdown for proactivity state
 */
export function generateProactivityContent(data: {
  level: number;
  suggestionsByType: Record<string, { total: number; accepted: number; rate: number }>;
  recommendations: string[];
}): string {
  const lines: string[] = [
    '# Proactivity Settings',
    '',
    `**Current Level:** ${Math.round(data.level * 100)}%`,
    '',
    '## Suggestion Performance',
    '',
    '| Type | Total | Accepted | Rate |',
    '|------|-------|----------|------|',
  ];

  for (const [type, stats] of Object.entries(data.suggestionsByType)) {
    if (stats.total > 0) {
      lines.push(
        `| ${type} | ${stats.total} | ${stats.accepted} | ${Math.round(stats.rate * 100)}% |`
      );
    }
  }

  if (data.recommendations.length > 0) {
    lines.push('', '## Recommendations', '');
    for (const rec of data.recommendations) {
      lines.push(`- ${rec}`);
    }
  }

  lines.push('', '---', '*This file is managed by Atlas. Feel free to read but avoid editing.*');

  return lines.join('\n');
}

/**
 * Generate human-readable markdown for backstory
 */
export function generateBackstoryContent(data: {
  unlockedCount: number;
  totalFragments: number;
  trustLevel: number;
  unlockedFragments: Array<{ id: string; type: string; content: string; unlockedAt?: string }>;
  sharedExperiences: string[];
}): string {
  const lines: string[] = [
    '# Atlas Backstory',
    '',
    `**Fragments Unlocked:** ${data.unlockedCount} / ${data.totalFragments}`,
    `**Trust Level:** ${Math.round(data.trustLevel * 100)}%`,
    '',
    '## Unlocked Memories',
    '',
  ];

  if (data.unlockedFragments.length === 0) {
    lines.push('*No memories have surfaced yet...*');
  } else {
    for (const fragment of data.unlockedFragments) {
      lines.push(`### ${fragment.type.charAt(0).toUpperCase() + fragment.type.slice(1)} Memory`);
      if (fragment.unlockedAt) {
        lines.push(`*Surfaced: ${new Date(fragment.unlockedAt).toLocaleDateString()}*`);
      }
      lines.push('');
      lines.push(`> ${fragment.content}`);
      lines.push('');
    }
  }

  if (data.sharedExperiences.length > 0) {
    lines.push('## Shared Experiences', '');
    for (const exp of data.sharedExperiences) {
      lines.push(`- ${exp}`);
    }
    lines.push('');
  }

  lines.push('---', '*This file is managed by Atlas. Feel free to read but avoid editing.*');

  return lines.join('\n');
}
