/**
 * Atlas Desktop - Note Writer
 * Functions for creating and updating notes in the Obsidian vault
 */

import * as fse from 'fs-extra';
import * as path from 'path';
import matter from 'gray-matter';
import { format } from 'date-fns';
import { getVaultPath, VaultDirectory, VAULT_DIRECTORIES } from './obsidian-brain';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('NoteWriter');

/**
 * Note metadata interface
 */
export interface NoteMetadata {
  type: string;
  title?: string;
  created?: string;
  last_modified?: string;
  tags?: string[];
  [key: string]: unknown;
}

/**
 * Note creation options
 */
export interface CreateNoteOptions {
  /** Override existing note if it exists */
  overwrite?: boolean;
  /** Tags to add to the note */
  tags?: string[];
  /** Additional frontmatter fields */
  additionalMetadata?: Record<string, unknown>;
}

/**
 * Note update options
 */
export interface UpdateNoteOptions {
  /** Metadata fields to update */
  metadata?: Partial<NoteMetadata>;
  /** Replace entire content */
  content?: string;
  /** Append to existing content */
  append?: string;
  /** Prepend to existing content (after frontmatter) */
  prepend?: string;
}

/**
 * Sanitize a title for use as a filename
 */
export function sanitizeFilename(title: string): string {
  return title
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid chars
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
    .substring(0, 100); // Limit length
}

/**
 * Generate a unique filename if the file already exists
 */
async function getUniqueFilename(directory: string, baseFilename: string): Promise<string> {
  const vaultPath = getVaultPath();
  const dirPath = path.join(vaultPath, directory);
  const basePath = path.join(dirPath, `${baseFilename}.md`);

  if (!(await fse.pathExists(basePath))) {
    return `${baseFilename}.md`;
  }

  // Add timestamp suffix for uniqueness
  const timestamp = format(new Date(), 'yyyyMMdd-HHmmss');
  return `${baseFilename}-${timestamp}.md`;
}

/**
 * Get ISO date string for current time
 */
function getISODate(): string {
  return new Date().toISOString();
}

/**
 * Create a new note in the vault
 *
 * @param directory - The vault directory to create the note in
 * @param title - The title of the note (used for filename and H1)
 * @param content - The markdown content of the note (without frontmatter)
 * @param metadata - Frontmatter metadata
 * @param options - Additional options
 * @returns Path to the created note (relative to vault)
 */
export async function createNote(
  directory: VaultDirectory,
  title: string,
  content: string,
  metadata: NoteMetadata,
  options: CreateNoteOptions = {}
): Promise<string> {
  // Validate directory
  if (!VAULT_DIRECTORIES.includes(directory)) {
    throw new Error(`Invalid directory: ${directory}`);
  }

  const vaultPath = getVaultPath();
  const dirPath = path.join(vaultPath, directory);

  // Ensure directory exists
  await fse.ensureDir(dirPath);

  // Generate filename
  const baseFilename = sanitizeFilename(title);
  let filename: string;

  if (options.overwrite) {
    filename = `${baseFilename}.md`;
  } else {
    filename = await getUniqueFilename(directory, baseFilename);
  }

  const notePath = path.join(dirPath, filename);
  const relativePath = path.join(directory, filename);

  // Build metadata
  const now = getISODate();
  const fullMetadata: NoteMetadata = {
    ...metadata,
    ...options.additionalMetadata,
    title: title,
    created: metadata.created || now,
    last_modified: now,
  };

  // Add tags if provided
  if (options.tags && options.tags.length > 0) {
    fullMetadata.tags = [...(fullMetadata.tags || []), ...options.tags];
  }

  // Build the note content
  const noteContent = buildNoteContent(title, content, fullMetadata);

  // Write the file
  await fse.writeFile(notePath, noteContent, 'utf-8');

  logger.info('Created note', { path: relativePath, title });

  return relativePath;
}

/**
 * Build the full note content with frontmatter
 */
function buildNoteContent(title: string, content: string, metadata: NoteMetadata): string {
  // Use gray-matter to create frontmatter
  const frontmatter = matter.stringify('', metadata);

  // Add title as H1 and content
  const body = `# ${title}\n\n${content}`;

  // Combine frontmatter with body
  return frontmatter + body;
}

/**
 * Read a note and parse its frontmatter
 */
export async function readNote(
  notePath: string
): Promise<{ metadata: NoteMetadata; content: string } | null> {
  const vaultPath = getVaultPath();
  const fullPath = path.isAbsolute(notePath) ? notePath : path.join(vaultPath, notePath);

  if (!(await fse.pathExists(fullPath))) {
    return null;
  }

  const fileContent = await fse.readFile(fullPath, 'utf-8');
  const parsed = matter(fileContent);

  return {
    metadata: parsed.data as NoteMetadata,
    content: parsed.content,
  };
}

/**
 * Update an existing note
 *
 * @param notePath - Path to the note (relative to vault or absolute)
 * @param updates - The updates to apply
 */
export async function updateNote(notePath: string, updates: UpdateNoteOptions): Promise<void> {
  const vaultPath = getVaultPath();
  const fullPath = path.isAbsolute(notePath) ? notePath : path.join(vaultPath, notePath);

  if (!(await fse.pathExists(fullPath))) {
    throw new Error(`Note not found: ${notePath}`);
  }

  // Read existing note
  const fileContent = await fse.readFile(fullPath, 'utf-8');
  const parsed = matter(fileContent);

  let newMetadata = { ...parsed.data } as NoteMetadata;
  let newContent = parsed.content;

  // Update metadata
  if (updates.metadata) {
    newMetadata = {
      ...newMetadata,
      ...updates.metadata,
      last_modified: getISODate(),
    };
  } else {
    // Always update last_modified when updating
    newMetadata.last_modified = getISODate();
  }

  // Handle content updates
  if (updates.content !== undefined) {
    // Replace entire content
    newContent = updates.content;
  }

  if (updates.prepend) {
    // Prepend after the H1 title if present
    const h1Match = newContent.match(/^(#\s+.+\n\n?)/);
    if (h1Match) {
      newContent = h1Match[1] + updates.prepend + '\n\n' + newContent.slice(h1Match[0].length);
    } else {
      newContent = updates.prepend + '\n\n' + newContent;
    }
  }

  if (updates.append) {
    // Append to end of content
    newContent = newContent.trimEnd() + '\n\n' + updates.append;
  }

  // Rebuild the note
  const newFileContent = matter.stringify(newContent, newMetadata);

  // Write back
  await fse.writeFile(fullPath, newFileContent, 'utf-8');

  logger.info('Updated note', { path: notePath });
}

/**
 * Delete a note from the vault
 */
export async function deleteNote(notePath: string): Promise<boolean> {
  const vaultPath = getVaultPath();
  const fullPath = path.isAbsolute(notePath) ? notePath : path.join(vaultPath, notePath);

  if (!(await fse.pathExists(fullPath))) {
    logger.warn('Note not found for deletion', { path: notePath });
    return false;
  }

  await fse.remove(fullPath);
  logger.info('Deleted note', { path: notePath });
  return true;
}

/**
 * Move a note to a different directory
 */
export async function moveNote(notePath: string, targetDirectory: VaultDirectory): Promise<string> {
  if (!VAULT_DIRECTORIES.includes(targetDirectory)) {
    throw new Error(`Invalid directory: ${targetDirectory}`);
  }

  const vaultPath = getVaultPath();
  const sourcePath = path.isAbsolute(notePath) ? notePath : path.join(vaultPath, notePath);

  if (!(await fse.pathExists(sourcePath))) {
    throw new Error(`Note not found: ${notePath}`);
  }

  const filename = path.basename(sourcePath);
  const targetDir = path.join(vaultPath, targetDirectory);
  const targetPath = path.join(targetDir, filename);

  await fse.ensureDir(targetDir);
  await fse.move(sourcePath, targetPath);

  const newRelativePath = path.join(targetDirectory, filename);
  logger.info('Moved note', { from: notePath, to: newRelativePath });

  return newRelativePath;
}

/**
 * Rename a note
 */
export async function renameNote(notePath: string, newTitle: string): Promise<string> {
  const vaultPath = getVaultPath();
  const sourcePath = path.isAbsolute(notePath) ? notePath : path.join(vaultPath, notePath);

  if (!(await fse.pathExists(sourcePath))) {
    throw new Error(`Note not found: ${notePath}`);
  }

  const directory = path.dirname(sourcePath);
  const newFilename = `${sanitizeFilename(newTitle)}.md`;
  const targetPath = path.join(directory, newFilename);

  // Read and update the note
  const fileContent = await fse.readFile(sourcePath, 'utf-8');
  const parsed = matter(fileContent);

  // Update title in metadata and content
  parsed.data.title = newTitle;
  parsed.data.last_modified = getISODate();

  // Update H1 in content
  const newContent = parsed.content.replace(/^#\s+.+/, `# ${newTitle}`);

  // Write to new location
  const newFileContent = matter.stringify(newContent, parsed.data);
  await fse.writeFile(targetPath, newFileContent, 'utf-8');

  // Remove old file if different
  if (sourcePath !== targetPath) {
    await fse.remove(sourcePath);
  }

  const relativeDirectory = path.relative(vaultPath, directory);
  const newRelativePath = path.join(relativeDirectory, newFilename);

  logger.info('Renamed note', { from: notePath, to: newRelativePath, newTitle });

  return newRelativePath;
}

/**
 * Add a section to a note
 */
export async function addSection(
  notePath: string,
  sectionTitle: string,
  sectionContent: string
): Promise<void> {
  const sectionMarkdown = `## ${sectionTitle}\n\n${sectionContent}`;
  await updateNote(notePath, { append: sectionMarkdown });
}

/**
 * Create a quick note with minimal setup
 */
export async function createQuickNote(
  directory: VaultDirectory,
  title: string,
  content: string
): Promise<string> {
  return createNote(directory, title, content, { type: directory }, { overwrite: false });
}

/**
 * Forget (delete) a note and optionally remove it from LanceDB
 * This is the inverse of createNote - removes a note completely
 *
 * @param notePath - Path to the note (relative to vault or absolute)
 * @param options - Forgetting options
 * @returns Object indicating what was deleted
 */
export async function forgetNote(
  notePath: string,
  options: {
    /** Also remove from LanceDB vector store */
    removeFromIndex?: boolean;
    /** Reason for deletion (for logging) */
    reason?: string;
  } = {}
): Promise<{
  noteDeleted: boolean;
  indexRemoved: boolean;
  notePath: string;
}> {
  const { removeFromIndex = true, reason = 'manual' } = options;
  const result = {
    noteDeleted: false,
    indexRemoved: false,
    notePath,
  };

  logger.info('Forgetting note', { path: notePath, removeFromIndex, reason });

  // Delete the note file
  const deleted = await deleteNote(notePath);
  result.noteDeleted = deleted;

  if (!deleted) {
    logger.warn('Note not found for forgetting', { path: notePath });
    return result;
  }

  // Remove from LanceDB if requested
  if (removeFromIndex) {
    try {
      // Lazy import to avoid circular dependencies
      const { getLanceSyncManager } = await import('./lance-sync');
      const syncManager = await getLanceSyncManager();
      result.indexRemoved = await syncManager.removeFromIndex(notePath);
      logger.debug('Removed note from LanceDB index', { path: notePath });
    } catch (error) {
      logger.warn('Failed to remove note from LanceDB index', {
        path: notePath,
        error: (error as Error).message,
      });
    }
  }

  logger.info('Note forgotten', {
    path: notePath,
    noteDeleted: result.noteDeleted,
    indexRemoved: result.indexRemoved,
    reason,
  });

  return result;
}

/**
 * Forget multiple notes matching a pattern or in a directory
 *
 * @param options - Options for batch forgetting
 * @returns Summary of deleted notes
 */
export async function forgetNotes(options: {
  /** Directory to delete notes from */
  directory?: VaultDirectory;
  /** Glob pattern for note names (e.g., "conversation-*") */
  pattern?: string;
  /** Maximum notes to delete (safety limit) */
  limit?: number;
  /** Also remove from LanceDB */
  removeFromIndex?: boolean;
  /** Reason for deletion */
  reason?: string;
}): Promise<{
  totalFound: number;
  deleted: number;
  failed: number;
  paths: string[];
}> {
  const { directory, pattern, limit = 100, removeFromIndex = true, reason = 'batch' } = options;
  const result = {
    totalFound: 0,
    deleted: 0,
    failed: 0,
    paths: [] as string[],
  };

  const vaultPath = getVaultPath();
  let searchPath: string;
  let files: string[] = [];

  if (directory) {
    searchPath = path.join(vaultPath, directory);
    if (await fse.pathExists(searchPath)) {
      files = await fse.readdir(searchPath);
      files = files
        .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
        .map((f) => path.join(directory, f));
    }
  } else {
    // Search all directories
    for (const dir of VAULT_DIRECTORIES) {
      const dirPath = path.join(vaultPath, dir);
      if (await fse.pathExists(dirPath)) {
        const dirFiles = await fse.readdir(dirPath);
        files.push(
          ...dirFiles
            .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
            .map((f) => path.join(dir, f))
        );
      }
    }
  }

  // Apply pattern filter if provided
  if (pattern) {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
    files = files.filter((f) => regex.test(path.basename(f)));
  }

  result.totalFound = files.length;

  // Apply limit
  const toDelete = files.slice(0, limit);

  logger.info('Batch forgetting notes', {
    directory,
    pattern,
    found: result.totalFound,
    toDelete: toDelete.length,
    reason,
  });

  // Delete each note
  for (const filePath of toDelete) {
    try {
      const forgetResult = await forgetNote(filePath, { removeFromIndex, reason });
      if (forgetResult.noteDeleted) {
        result.deleted++;
        result.paths.push(filePath);
      } else {
        result.failed++;
      }
    } catch (error) {
      result.failed++;
      logger.error('Failed to forget note', {
        path: filePath,
        error: (error as Error).message,
      });
    }
  }

  logger.info('Batch forget completed', {
    found: result.totalFound,
    deleted: result.deleted,
    failed: result.failed,
    reason,
  });

  return result;
}
