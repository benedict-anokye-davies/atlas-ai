/**
 * @file Edit Engine for the Coding Agent
 * @description Surgical file editing with diff generation, validation, and rollback
 */

import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { createModuleLogger } from '../../utils/logger';
import { getErrorMessage, isoDateTime } from '../../../shared/utils';
import type {
  FileEdit,
  EditValidation,
  EditResult,
  BatchEditResult,
  FileDiff,
  DiffHunk,
  DiffLine,
} from './types';

const logger = createModuleLogger('EditEngine');
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);
const mkdirAsync = promisify(fs.mkdir);
const renameAsync = promisify(fs.rename);
const copyFileAsync = promisify(fs.copyFile);

/**
 * Edit Engine for safe file modifications
 */
export class EditEngine {
  /** Backup directory for rollback support */
  private backupDir: string;
  /** Stack of edit operations for rollback */
  private editStack: EditResult[] = [];
  /** Maximum edits to keep in history */
  private maxHistorySize = 100;

  constructor(backupDir?: string) {
    this.backupDir = backupDir || path.join(process.cwd(), '.atlas-backups');
  }

  /**
   * Validate an edit before applying it
   */
  async validateEdit(edit: FileEdit): Promise<EditValidation> {
    const validation: EditValidation = {
      valid: true,
      errors: [],
      warnings: [],
    };

    try {
      switch (edit.type) {
        case 'create':
          await this.validateCreate(edit, validation);
          break;
        case 'modify':
          await this.validateModify(edit, validation);
          break;
        case 'delete':
          await this.validateDelete(edit, validation);
          break;
        case 'rename':
          await this.validateRename(edit, validation);
          break;
        default:
          validation.errors.push(`Unknown edit type: ${(edit as FileEdit).type}`);
          validation.valid = false;
      }
    } catch (error) {
      validation.errors.push(`Validation error: ${getErrorMessage(error)}`);
      validation.valid = false;
    }

    return validation;
  }

  private async validateCreate(edit: FileEdit, validation: EditValidation): Promise<void> {
    if (!edit.newContent) {
      validation.errors.push('create operation requires newContent');
      validation.valid = false;
      return;
    }

    if (fs.existsSync(edit.file)) {
      validation.errors.push(`File already exists: ${edit.file}. Use 'modify' to edit existing files.`);
      validation.valid = false;
      return;
    }

    // Check parent directory
    const dir = path.dirname(edit.file);
    if (!fs.existsSync(dir)) {
      validation.warnings.push(`Parent directory will be created: ${dir}`);
    }
  }

  private async validateModify(edit: FileEdit, validation: EditValidation): Promise<void> {
    if (!edit.oldContent) {
      validation.errors.push('modify operation requires oldContent (the text to replace)');
      validation.valid = false;
      return;
    }

    if (edit.newContent === undefined) {
      validation.errors.push('modify operation requires newContent');
      validation.valid = false;
      return;
    }

    if (!fs.existsSync(edit.file)) {
      validation.errors.push(`File not found: ${edit.file}`);
      validation.valid = false;
      return;
    }

    // Check if oldContent exists in the file
    const content = await readFileAsync(edit.file, 'utf-8');
    const matches = content.split(edit.oldContent).length - 1;

    validation.matchCount = matches;
    validation.targetFound = matches > 0;

    if (matches === 0) {
      // Try to provide helpful hints
      const oldLines = edit.oldContent.split('\n').filter(l => l.trim());
      const firstLine = oldLines[0]?.trim();

      if (firstLine && content.includes(firstLine)) {
        validation.errors.push(
          `oldContent not found in file. The first line "${firstLine.substring(0, 40)}..." exists, ` +
          `but the full match failed. Check whitespace and indentation.`
        );
      } else {
        validation.errors.push('oldContent not found in file.');
      }
      validation.valid = false;
    } else if (matches > 1) {
      validation.errors.push(
        `oldContent matches ${matches} locations. Add more context to make it unique.`
      );
      validation.valid = false;
    }
  }

  private async validateDelete(edit: FileEdit, validation: EditValidation): Promise<void> {
    if (!fs.existsSync(edit.file)) {
      validation.errors.push(`File not found: ${edit.file}`);
      validation.valid = false;
      return;
    }

    const stat = fs.statSync(edit.file);
    if (stat.isDirectory()) {
      validation.errors.push('Cannot delete directories. Use a different method.');
      validation.valid = false;
      return;
    }

    // Warn about important files
    const basename = path.basename(edit.file);
    const importantFiles = ['package.json', 'tsconfig.json', '.gitignore', 'README.md'];
    if (importantFiles.includes(basename)) {
      validation.warnings.push(`Warning: ${basename} is a potentially important file.`);
    }
  }

  private async validateRename(edit: FileEdit, validation: EditValidation): Promise<void> {
    if (!edit.newPath) {
      validation.errors.push('rename operation requires newPath');
      validation.valid = false;
      return;
    }

    if (!fs.existsSync(edit.file)) {
      validation.errors.push(`Source file not found: ${edit.file}`);
      validation.valid = false;
      return;
    }

    if (fs.existsSync(edit.newPath)) {
      validation.errors.push(`Destination already exists: ${edit.newPath}`);
      validation.valid = false;
      return;
    }
  }

  /**
   * Apply a single edit operation
   */
  async applyEdit(edit: FileEdit): Promise<EditResult> {
    const result: EditResult = {
      success: false,
      file: edit.file,
    };

    try {
      // Validate first
      const validation = await this.validateEdit(edit);
      if (!validation.valid) {
        result.error = validation.errors.join('; ');
        return result;
      }

      // Ensure backup directory exists
      await this.ensureBackupDir();

      switch (edit.type) {
        case 'create':
          await this.applyCreate(edit, result);
          break;
        case 'modify':
          await this.applyModify(edit, result);
          break;
        case 'delete':
          await this.applyDelete(edit, result);
          break;
        case 'rename':
          await this.applyRename(edit, result);
          break;
      }

      // Add to edit stack
      if (result.success) {
        this.editStack.push(result);
        if (this.editStack.length > this.maxHistorySize) {
          this.editStack.shift();
        }
        logger.info('Edit applied', { type: edit.type, file: edit.file });
      }

    } catch (error) {
      result.error = getErrorMessage(error);
      logger.error('Edit failed', { type: edit.type, file: edit.file, error: result.error });
    }

    return result;
  }

  private async applyCreate(edit: FileEdit, result: EditResult): Promise<void> {
    const dir = path.dirname(edit.file);
    if (!fs.existsSync(dir)) {
      await mkdirAsync(dir, { recursive: true });
    }

    await writeFileAsync(edit.file, edit.newContent!, 'utf-8');
    result.success = true;
    result.diff = this.generateDiff('', edit.newContent!, edit.file);
    result.linesAffected = { start: 1, end: edit.newContent!.split('\n').length };
  }

  private async applyModify(edit: FileEdit, result: EditResult): Promise<void> {
    const originalContent = await readFileAsync(edit.file, 'utf-8');
    result.originalContent = originalContent;

    const newContent = originalContent.replace(edit.oldContent!, edit.newContent!);
    await writeFileAsync(edit.file, newContent, 'utf-8');

    result.success = true;
    result.diff = this.generateDiff(edit.oldContent!, edit.newContent!, edit.file);

    // Calculate affected lines
    const startLine = originalContent.substring(0, originalContent.indexOf(edit.oldContent!)).split('\n').length;
    result.linesAffected = {
      start: startLine,
      end: startLine + edit.newContent!.split('\n').length - 1,
    };
  }

  private async applyDelete(edit: FileEdit, result: EditResult): Promise<void> {
    const originalContent = await readFileAsync(edit.file, 'utf-8');
    result.originalContent = originalContent;

    // Backup before deletion
    const backupPath = this.getBackupPath(edit.file);
    await copyFileAsync(edit.file, backupPath);

    await unlinkAsync(edit.file);
    result.success = true;
    result.diff = this.generateDiff(originalContent, '', edit.file);
  }

  private async applyRename(edit: FileEdit, result: EditResult): Promise<void> {
    const dir = path.dirname(edit.newPath!);
    if (!fs.existsSync(dir)) {
      await mkdirAsync(dir, { recursive: true });
    }

    await renameAsync(edit.file, edit.newPath!);
    result.success = true;
    result.file = edit.newPath!;
  }

  /**
   * Apply multiple edits as a batch
   */
  async applyBatch(edits: FileEdit[]): Promise<BatchEditResult> {
    const results: EditResult[] = [];
    const appliedResults: EditResult[] = [];

    for (const edit of edits) {
      const result = await this.applyEdit(edit);
      results.push(result);

      if (result.success) {
        appliedResults.push(result);
      } else {
        // Rollback all successful edits on failure
        logger.warn('Edit failed, rolling back batch', { file: edit.file, error: result.error });
        
        for (const applied of appliedResults.reverse()) {
          await this.rollbackEdit(applied);
        }

        return {
          success: false,
          edits: results,
          successCount: 0,
          failureCount: results.length,
        };
      }
    }

    return {
      success: true,
      edits: results,
      successCount: results.filter(r => r.success).length,
      failureCount: results.filter(r => !r.success).length,
      rollback: async () => {
        for (const result of results.reverse()) {
          if (result.success) {
            await this.rollbackEdit(result);
          }
        }
      },
    };
  }

  /**
   * Rollback a single edit
   */
  async rollbackEdit(result: EditResult): Promise<boolean> {
    try {
      if (!result.success || !result.originalContent) {
        return false;
      }

      await writeFileAsync(result.file, result.originalContent, 'utf-8');
      logger.info('Edit rolled back', { file: result.file });
      return true;
    } catch (error) {
      logger.error('Rollback failed', { file: result.file, error: getErrorMessage(error) });
      return false;
    }
  }

  /**
   * Rollback the last N edits
   */
  async rollbackLast(count: number = 1): Promise<number> {
    let rolledBack = 0;

    for (let i = 0; i < count && this.editStack.length > 0; i++) {
      const edit = this.editStack.pop();
      if (edit && await this.rollbackEdit(edit)) {
        rolledBack++;
      }
    }

    return rolledBack;
  }

  /**
   * Generate a unified diff string
   */
  generateDiff(oldContent: string, newContent: string, filePath: string): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    // Simple diff generation
    let diff = `--- a/${filePath}\n+++ b/${filePath}\n`;

    // Find changed regions
    const changes = this.computeChanges(oldLines, newLines);

    for (const change of changes) {
      diff += `@@ -${change.oldStart + 1},${change.oldCount} +${change.newStart + 1},${change.newCount} @@\n`;

      // Context before
      for (let i = Math.max(0, change.oldStart - 3); i < change.oldStart; i++) {
        diff += ` ${oldLines[i]}\n`;
      }

      // Removed lines
      for (let i = change.oldStart; i < change.oldStart + change.oldCount; i++) {
        diff += `-${oldLines[i]}\n`;
      }

      // Added lines
      for (let i = change.newStart; i < change.newStart + change.newCount; i++) {
        diff += `+${newLines[i]}\n`;
      }

      // Context after
      const contextEnd = Math.min(oldLines.length, change.oldStart + change.oldCount + 3);
      for (let i = change.oldStart + change.oldCount; i < contextEnd; i++) {
        diff += ` ${oldLines[i]}\n`;
      }
    }

    return diff;
  }

  /**
   * Compute changes between two arrays of lines
   */
  private computeChanges(
    oldLines: string[],
    newLines: string[]
  ): { oldStart: number; oldCount: number; newStart: number; newCount: number }[] {
    const changes: { oldStart: number; oldCount: number; newStart: number; newCount: number }[] = [];

    // Simple LCS-based diff
    let oldIdx = 0;
    let newIdx = 0;

    while (oldIdx < oldLines.length || newIdx < newLines.length) {
      // Skip matching lines
      while (oldIdx < oldLines.length && newIdx < newLines.length && oldLines[oldIdx] === newLines[newIdx]) {
        oldIdx++;
        newIdx++;
      }

      if (oldIdx >= oldLines.length && newIdx >= newLines.length) {
        break;
      }

      // Find extent of change
      const changeStart = { old: oldIdx, new: newIdx };

      // Look for next matching line
      let foundMatch = false;
      for (let lookAhead = 1; lookAhead < 10; lookAhead++) {
        // Check if we can match by skipping old lines
        if (oldIdx + lookAhead < oldLines.length && oldLines[oldIdx + lookAhead] === newLines[newIdx]) {
          changes.push({
            oldStart: changeStart.old,
            oldCount: lookAhead,
            newStart: changeStart.new,
            newCount: 0,
          });
          oldIdx += lookAhead;
          foundMatch = true;
          break;
        }

        // Check if we can match by skipping new lines
        if (newIdx + lookAhead < newLines.length && oldLines[oldIdx] === newLines[newIdx + lookAhead]) {
          changes.push({
            oldStart: changeStart.old,
            oldCount: 0,
            newStart: changeStart.new,
            newCount: lookAhead,
          });
          newIdx += lookAhead;
          foundMatch = true;
          break;
        }
      }

      if (!foundMatch) {
        // Record as a replacement
        let oldEnd = oldIdx;
        let newEnd = newIdx;

        while (oldEnd < oldLines.length && newEnd < newLines.length && oldLines[oldEnd] !== newLines[newEnd]) {
          oldEnd++;
          newEnd++;
        }

        // Handle case where one side runs out
        if (oldEnd >= oldLines.length) {
          while (newEnd < newLines.length) newEnd++;
        }
        if (newEnd >= newLines.length) {
          while (oldEnd < oldLines.length) oldEnd++;
        }

        changes.push({
          oldStart: changeStart.old,
          oldCount: oldEnd - changeStart.old,
          newStart: changeStart.new,
          newCount: newEnd - changeStart.new,
        });

        oldIdx = oldEnd;
        newIdx = newEnd;
      }
    }

    return changes;
  }

  /**
   * Generate a structured diff object
   */
  generateStructuredDiff(oldContent: string, newContent: string, filePath: string): FileDiff {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const changes = this.computeChanges(oldLines, newLines);

    const hunks: DiffHunk[] = changes.map(change => {
      const lines: DiffLine[] = [];

      // Context before
      for (let i = Math.max(0, change.oldStart - 3); i < change.oldStart; i++) {
        lines.push({
          type: 'context',
          content: oldLines[i],
          oldLineNumber: i + 1,
          newLineNumber: i + 1 + (change.newStart - change.oldStart),
        });
      }

      // Removed lines
      for (let i = change.oldStart; i < change.oldStart + change.oldCount; i++) {
        lines.push({
          type: 'remove',
          content: oldLines[i],
          oldLineNumber: i + 1,
        });
      }

      // Added lines
      for (let i = change.newStart; i < change.newStart + change.newCount; i++) {
        lines.push({
          type: 'add',
          content: newLines[i],
          newLineNumber: i + 1,
        });
      }

      return {
        oldStart: change.oldStart + 1,
        oldLines: change.oldCount,
        newStart: change.newStart + 1,
        newLines: change.newCount,
        lines,
      };
    });

    let additions = 0;
    let deletions = 0;

    for (const change of changes) {
      deletions += change.oldCount;
      additions += change.newCount;
    }

    const diffType = oldContent === ''
      ? 'add'
      : newContent === ''
        ? 'delete'
        : 'modify';

    return {
      oldPath: filePath,
      newPath: filePath,
      type: diffType,
      hunks,
      additions,
      deletions,
    };
  }

  /**
   * Ensure backup directory exists
   */
  private async ensureBackupDir(): Promise<void> {
    if (!fs.existsSync(this.backupDir)) {
      await mkdirAsync(this.backupDir, { recursive: true });
    }
  }

  /**
   * Get backup path for a file
   */
  private getBackupPath(filePath: string): string {
    const timestamp = isoDateTime().replace(/[:.]/g, '-');
    const basename = path.basename(filePath);
    return path.join(this.backupDir, `${timestamp}_${basename}`);
  }

  /**
   * Get edit history
   */
  getEditHistory(): EditResult[] {
    return [...this.editStack];
  }

  /**
   * Clear edit history
   */
  clearHistory(): void {
    this.editStack = [];
  }
}

// Singleton instance
let editEngineInstance: EditEngine | null = null;

/**
 * Get the edit engine instance
 */
export function getEditEngine(): EditEngine {
  if (!editEngineInstance) {
    editEngineInstance = new EditEngine();
  }
  return editEngineInstance;
}

export default EditEngine;
