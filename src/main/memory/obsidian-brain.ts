/**
 * Atlas Desktop - Obsidian Brain
 * Human-readable markdown vault for Atlas's knowledge with [[backlinks]]
 */

import * as fse from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('ObsidianBrain');

/**
 * Vault directory names
 */
export const VAULT_DIRECTORIES = [
  'people',
  'concepts',
  'skills',
  'tasks',
  'conversations',
  'research',
  'daily',
  'self',
  'profile',
  'logs',
  'learning',
] as const;

export type VaultDirectory = (typeof VAULT_DIRECTORIES)[number];

/**
 * Get the vault path based on platform
 */
export function getVaultPath(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.atlas', 'brain');
}

/**
 * Get the path to a specific vault directory
 */
export function getDirectoryPath(directory: VaultDirectory): string {
  return path.join(getVaultPath(), directory);
}

/**
 * MOC (Map of Content) template for each directory
 */
function getMOCContent(directory: VaultDirectory): string {
  const descriptions: Record<VaultDirectory, string> = {
    people: 'People Atlas knows about and interacts with.',
    concepts: 'Knowledge and concepts Atlas has learned.',
    skills: 'Tools, scripts, and solutions Atlas has created.',
    tasks: 'History of tasks Atlas has completed.',
    conversations: 'Summaries of conversations with the user.',
    research: 'Research and knowledge Atlas has gathered.',
    daily: 'Daily journals and briefings.',
    self: "Atlas's self-reflection, personality, and growth.",
    profile: "Understanding of the user's preferences and routines.",
    logs: 'Audit logs and operation history.',
    learning: 'Learning resources and educational content.',
  };

  return `---
type: moc
directory: ${directory}
created: ${new Date().toISOString()}
---

# ${directory.charAt(0).toUpperCase() + directory.slice(1)}

${descriptions[directory]}

## Recent Notes

*Notes will be automatically linked here as they are created.*

## All Notes

*This section will be populated with backlinks to notes in this folder.*

#moc #${directory}
`;
}

/**
 * Obsidian configuration files
 */
const OBSIDIAN_CONFIG = {
  'app.json': {
    promptDelete: false,
    showLineNumber: true,
    strictLineBreaks: false,
    showFrontmatter: true,
    foldHeading: true,
    foldIndent: true,
    showInlineTitle: true,
    alwaysUpdateLinks: true,
    newLinkFormat: 'shortest',
    useMarkdownLinks: false,
    attachmentFolderPath: './_attachments',
  },
  'appearance.json': {
    accentColor: '#705dcf',
    baseFontSize: 16,
    enabledCssSnippets: [],
    interfaceFontFamily: '',
    monospaceFontFamily: '',
    textFontFamily: '',
    cssTheme: '',
  },
  'graph.json': {
    collapse_filter: false,
    search: '',
    showTags: true,
    showAttachments: false,
    hideUnresolved: false,
    showOrphans: true,
    collapse_color: false,
    colorGroups: [
      { query: 'path:daily', color: { a: 1, rgb: 5635925 } },
      { query: 'path:people', color: { a: 1, rgb: 16744448 } },
      { query: 'path:concepts', color: { a: 1, rgb: 65280 } },
      { query: 'path:tasks', color: { a: 1, rgb: 16776960 } },
      { query: 'path:self', color: { a: 1, rgb: 16711935 } },
    ],
    collapse_display: false,
    showArrow: true,
    textFadeMultiplier: 0,
    nodeSizeMultiplier: 1,
    lineSizeMultiplier: 1,
    collapse_forces: false,
    centerStrength: 0.518713,
    repelStrength: 10,
    linkStrength: 1,
    linkDistance: 250,
    scale: 1,
    close: false,
  },
};

/**
 * Initialize the Obsidian vault structure
 * Creates all necessary directories and configuration files
 */
export async function initializeVault(): Promise<void> {
  const vaultPath = getVaultPath();

  logger.info('Initializing Obsidian vault', { path: vaultPath });

  try {
    // Create vault directory
    await fse.ensureDir(vaultPath);

    // Create subdirectories with MOC files
    for (const dir of VAULT_DIRECTORIES) {
      const dirPath = path.join(vaultPath, dir);
      await fse.ensureDir(dirPath);

      // Create MOC file if it doesn't exist
      const mocPath = path.join(dirPath, '_index.md');
      if (!(await fse.pathExists(mocPath))) {
        await fse.writeFile(mocPath, getMOCContent(dir), 'utf-8');
        logger.debug('Created MOC file', { directory: dir });
      }
    }

    // Create .obsidian config directory
    const obsidianDir = path.join(vaultPath, '.obsidian');
    await fse.ensureDir(obsidianDir);

    // Write config files
    for (const [filename, config] of Object.entries(OBSIDIAN_CONFIG)) {
      const configPath = path.join(obsidianDir, filename);
      if (!(await fse.pathExists(configPath))) {
        await fse.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
        logger.debug('Created Obsidian config', { file: filename });
      }
    }

    // Create workspace file for Obsidian
    const workspacePath = path.join(obsidianDir, 'workspace.json');
    if (!(await fse.pathExists(workspacePath))) {
      await fse.writeFile(
        workspacePath,
        JSON.stringify(
          {
            main: {
              id: 'main',
              type: 'split',
              children: [
                {
                  id: 'editor',
                  type: 'leaf',
                  state: { type: 'empty', state: {} },
                },
              ],
              direction: 'vertical',
            },
            left: { id: 'left', type: 'mobile-drawer', children: [], direction: 'horizontal' },
            right: { id: 'right', type: 'mobile-drawer', children: [], direction: 'horizontal' },
            active: 'editor',
            lastOpenFiles: [],
          },
          null,
          2
        ),
        'utf-8'
      );
    }

    logger.info('Obsidian vault initialized successfully', {
      path: vaultPath,
      directories: VAULT_DIRECTORIES.length,
    });
  } catch (error) {
    logger.error('Failed to initialize vault', { error: (error as Error).message });
    throw error;
  }
}

/**
 * Check if the vault has been initialized
 */
export async function isVaultInitialized(): Promise<boolean> {
  const vaultPath = getVaultPath();

  // Check if vault directory exists
  if (!(await fse.pathExists(vaultPath))) {
    return false;
  }

  // Check if all subdirectories exist
  for (const dir of VAULT_DIRECTORIES) {
    const dirPath = path.join(vaultPath, dir);
    if (!(await fse.pathExists(dirPath))) {
      return false;
    }
  }

  // Check if .obsidian config exists
  const obsidianDir = path.join(vaultPath, '.obsidian');
  if (!(await fse.pathExists(obsidianDir))) {
    return false;
  }

  return true;
}

/**
 * Get list of all notes in the vault
 */
export async function getAllNotes(): Promise<string[]> {
  const vaultPath = getVaultPath();
  const notes: string[] = [];

  for (const dir of VAULT_DIRECTORIES) {
    const dirPath = path.join(vaultPath, dir);
    if (await fse.pathExists(dirPath)) {
      const files = await fse.readdir(dirPath);
      for (const file of files) {
        if (file.endsWith('.md') && !file.startsWith('_')) {
          notes.push(path.join(dir, file));
        }
      }
    }
  }

  return notes;
}

/**
 * Get the path to a note by its title (without .md extension)
 */
export function getNotePath(directory: VaultDirectory, title: string): string {
  // Sanitize title for filename (remove special chars, limit length)
  const sanitized = title
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 100);
  return path.join(getVaultPath(), directory, `${sanitized}.md`);
}

/**
 * Check if a note exists
 */
export async function noteExists(directory: VaultDirectory, title: string): Promise<boolean> {
  const notePath = getNotePath(directory, title);
  return fse.pathExists(notePath);
}

/**
 * Delete the entire vault (for testing/reset)
 */
export async function deleteVault(): Promise<void> {
  const vaultPath = getVaultPath();
  logger.warn('Deleting entire vault', { path: vaultPath });
  await fse.remove(vaultPath);
}

/**
 * Get vault statistics
 */
export async function getVaultStats(): Promise<{
  totalNotes: number;
  notesByDirectory: Record<VaultDirectory, number>;
  totalSize: number;
}> {
  const vaultPath = getVaultPath();
  const notesByDirectory: Record<string, number> = {};
  let totalNotes = 0;
  let totalSize = 0;

  for (const dir of VAULT_DIRECTORIES) {
    const dirPath = path.join(vaultPath, dir);
    let count = 0;

    if (await fse.pathExists(dirPath)) {
      const files = await fse.readdir(dirPath);
      for (const file of files) {
        if (file.endsWith('.md') && !file.startsWith('_')) {
          count++;
          const filePath = path.join(dirPath, file);
          const stats = await fse.stat(filePath);
          totalSize += stats.size;
        }
      }
    }

    notesByDirectory[dir] = count;
    totalNotes += count;
  }

  return {
    totalNotes,
    notesByDirectory: notesByDirectory as Record<VaultDirectory, number>,
    totalSize,
  };
}
