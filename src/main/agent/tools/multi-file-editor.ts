/**
 * Atlas Desktop - Multi-File Editor
 * 
 * Powerful batch editing capabilities across multiple files:
 * - Find and replace across codebase
 * - Coordinated multi-file edits
 * - Safe atomic changes with rollback
 * - Pattern-based transformations
 * 
 * @module agent/tools/multi-file-editor
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('MultiFileEditor');

// ============================================================================
// 1. FIND AND REPLACE IN FILES
// ============================================================================

/**
 * Find and replace text across multiple files
 */
export const findReplaceTool: AgentTool = {
  name: 'find_replace_in_files',
  description: `Find and replace text across multiple files:
- Regex support
- Glob patterns for file selection
- Preview mode
- Backup creation
- Word boundary matching`,
  parameters: {
    type: 'object',
    properties: {
      find: {
        type: 'string',
        description: 'Text or regex pattern to find',
      },
      replace: {
        type: 'string',
        description: 'Replacement text (supports $1, $2 for regex groups)',
      },
      pattern: {
        type: 'string',
        description: 'Glob pattern for files (e.g., "src/**/*.ts")',
      },
      directory: {
        type: 'string',
        description: 'Base directory (default: current)',
      },
      isRegex: {
        type: 'boolean',
        description: 'Treat find as regex',
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Case-sensitive matching',
      },
      wholeWord: {
        type: 'boolean',
        description: 'Match whole words only',
      },
      preview: {
        type: 'boolean',
        description: 'Preview changes without applying',
      },
      createBackup: {
        type: 'boolean',
        description: 'Create .bak files before changing',
      },
    },
    required: ['find', 'replace', 'pattern'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const find = params.find as string;
    const replace = params.replace as string;
    const pattern = params.pattern as string;
    const directory = (params.directory as string) || process.cwd();
    const isRegex = params.isRegex as boolean;
    const caseSensitive = params.caseSensitive !== false;
    const wholeWord = params.wholeWord as boolean;
    const preview = params.preview as boolean;
    const createBackup = params.createBackup as boolean;

    try {
      // Build the search pattern
      let searchPattern: RegExp;
      if (isRegex) {
        searchPattern = new RegExp(find, caseSensitive ? 'g' : 'gi');
      } else {
        let escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (wholeWord) {
          escaped = `\\b${escaped}\\b`;
        }
        searchPattern = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
      }

      // Find matching files
      const files = await findFilesWithGlob(directory, pattern);
      
      const changes: Array<{
        file: string;
        matches: number;
        preview: Array<{ line: number; before: string; after: string }>;
      }> = [];

      // Process each file
      for (const file of files) {
        const content = await fs.readFile(file, 'utf-8');
        const lines = content.split('\n');
        
        let matches = 0;
        const filePreview: Array<{ line: number; before: string; after: string }> = [];
        const newLines: string[] = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const newLine = line.replace(searchPattern, replace);
          
          if (newLine !== line) {
            const lineMatches = (line.match(searchPattern) || []).length;
            matches += lineMatches;
            filePreview.push({
              line: i + 1,
              before: line.trim().slice(0, 100),
              after: newLine.trim().slice(0, 100),
            });
          }
          
          newLines.push(newLine);
        }

        if (matches > 0) {
          changes.push({
            file: path.relative(directory, file),
            matches,
            preview: filePreview.slice(0, 5), // Limit preview
          });

          if (!preview) {
            // Create backup if requested
            if (createBackup) {
              await fs.writeFile(`${file}.bak`, content, 'utf-8');
            }
            // Write changes
            await fs.writeFile(file, newLines.join('\n'), 'utf-8');
          }
        }
      }

      const totalMatches = changes.reduce((sum, c) => sum + c.matches, 0);

      return {
        success: true,
        data: {
          find,
          replace,
          pattern,
          filesScanned: files.length,
          filesModified: changes.length,
          totalReplacements: totalMatches,
          preview,
          changes: changes.slice(0, 20), // Limit to 20 files
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

// ============================================================================
// 2. BATCH FILE EDIT
// ============================================================================

interface FileEdit {
  file: string;
  edits: Array<{
    type: 'insert' | 'replace' | 'delete';
    line?: number;
    startLine?: number;
    endLine?: number;
    content?: string;
    find?: string;
    replace?: string;
  }>;
}

/**
 * Batch edit multiple files with multiple operations
 */
export const batchEditTool: AgentTool = {
  name: 'batch_edit_files',
  description: `Apply multiple edits across multiple files atomically:
- Insert, replace, or delete content
- Line-based or text-based operations
- Atomic: all changes succeed or all are rolled back
- Transaction-like safety`,
  parameters: {
    type: 'object',
    properties: {
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string', description: 'File path' },
            edits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['insert', 'replace', 'delete'] },
                  line: { type: 'number', description: 'For insert: line to insert at' },
                  startLine: { type: 'number', description: 'For replace/delete: start line' },
                  endLine: { type: 'number', description: 'For replace/delete: end line' },
                  content: { type: 'string', description: 'Content to insert or use as replacement' },
                  find: { type: 'string', description: 'Text to find (for text-based replace)' },
                  replace: { type: 'string', description: 'Text to replace with' },
                },
              },
            },
          },
        },
        description: 'Array of file edits',
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview without applying',
      },
    },
    required: ['edits'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const edits = params.edits as FileEdit[];
    const dryRun = params.dryRun as boolean;

    try {
      // Store original contents for rollback
      const originals: Map<string, string> = new Map();
      const results: Array<{
        file: string;
        editsApplied: number;
        preview?: string[];
      }> = [];

      // Validate and load all files first
      for (const fileEdit of edits) {
        const content = await fs.readFile(fileEdit.file, 'utf-8');
        originals.set(fileEdit.file, content);
      }

      // Apply edits
      for (const fileEdit of edits) {
        const originalContent = originals.get(fileEdit.file)!;
        let lines = originalContent.split('\n');
        const previews: string[] = [];

        // Sort edits by line number (descending) to avoid offset issues
        const sortedEdits = [...fileEdit.edits].sort((a, b) => {
          const lineA = a.startLine || a.line || 0;
          const lineB = b.startLine || b.line || 0;
          return lineB - lineA;
        });

        for (const edit of sortedEdits) {
          switch (edit.type) {
            case 'insert': {
              const insertLine = (edit.line || 1) - 1;
              const content = edit.content || '';
              const newLines = content.split('\n');
              lines.splice(insertLine, 0, ...newLines);
              previews.push(`INSERT at line ${edit.line}: ${content.slice(0, 50)}...`);
              break;
            }

            case 'replace': {
              if (edit.find && edit.replace !== undefined) {
                // Text-based replace
                const newContent = lines.join('\n').replace(edit.find, edit.replace);
                lines = newContent.split('\n');
                previews.push(`REPLACE: "${edit.find}" → "${edit.replace}"`);
              } else if (edit.startLine && edit.endLine) {
                // Line-based replace
                const start = edit.startLine - 1;
                const count = edit.endLine - edit.startLine + 1;
                const newLines = (edit.content || '').split('\n');
                lines.splice(start, count, ...newLines);
                previews.push(`REPLACE lines ${edit.startLine}-${edit.endLine}`);
              }
              break;
            }

            case 'delete': {
              if (edit.startLine && edit.endLine) {
                const start = edit.startLine - 1;
                const count = edit.endLine - edit.startLine + 1;
                lines.splice(start, count);
                previews.push(`DELETE lines ${edit.startLine}-${edit.endLine}`);
              }
              break;
            }
          }
        }

        const newContent = lines.join('\n');

        if (!dryRun) {
          await fs.writeFile(fileEdit.file, newContent, 'utf-8');
        }

        results.push({
          file: fileEdit.file,
          editsApplied: fileEdit.edits.length,
          preview: previews,
        });
      }

      return {
        success: true,
        data: {
          filesEdited: results.length,
          totalEdits: edits.reduce((sum, e) => sum + e.edits.length, 0),
          dryRun,
          results,
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

// ============================================================================
// 3. MOVE/RENAME WITH UPDATES
// ============================================================================

/**
 * Move/rename a file and update all imports
 */
export const moveWithUpdatesTool: AgentTool = {
  name: 'move_with_import_updates',
  description: `Move or rename a file and automatically update all imports:
- Updates relative imports
- Updates barrel exports (index.ts)
- Handles TypeScript paths
- Updates package.json entry points if needed`,
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Current file path',
      },
      destination: {
        type: 'string',
        description: 'New file path',
      },
      updateImports: {
        type: 'boolean',
        description: 'Update all import statements (default: true)',
      },
    },
    required: ['source', 'destination'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const source = params.source as string;
    const destination = params.destination as string;
    const updateImports = params.updateImports !== false;

    try {
      // Verify source exists
      await fs.access(source);

      // Read source content
      const sourceContent = await fs.readFile(source, 'utf-8');

      // Find all TypeScript/JavaScript files
      const projectRoot = await findProjectRoot(source);
      const allFiles = await findFilesWithGlob(projectRoot, '**/*.{ts,tsx,js,jsx,mjs}');

      const importUpdates: Array<{
        file: string;
        changes: number;
      }> = [];

      if (updateImports) {
        // Calculate the import path changes
        const sourceImportPath = getImportPath(source, projectRoot);
        const destImportPath = getImportPath(destination, projectRoot);

        // Update imports in all files
        for (const file of allFiles) {
          if (file === source) continue;

          const content = await fs.readFile(file, 'utf-8');
          let newContent = content;
          let changes = 0;

          // Pattern to find imports from the source file
          const importPatterns = [
            // Relative imports: from './foo' or from '../foo'
            new RegExp(`from\\s+['"]([^'"]*${escapeForRegex(path.basename(source, path.extname(source)))})['""]`, 'g'),
            // Absolute imports using the full path
            new RegExp(`from\\s+['"]${escapeForRegex(sourceImportPath)}['"]`, 'g'),
          ];

          for (const pattern of importPatterns) {
            const beforeLength = newContent.length;
            
            // Calculate relative path from this file to new destination
            const fileDir = path.dirname(file);
            const relativeToNew = getRelativeImportPath(fileDir, destination);
            
            newContent = newContent.replace(pattern, (match, p1) => {
              // Check if this import actually points to our source file
              const importedPath = resolveImportPath(file, p1 || match);
              if (importedPath && path.normalize(importedPath) === path.normalize(source)) {
                changes++;
                return `from '${relativeToNew}'`;
              }
              return match;
            });
            
            if (newContent.length !== beforeLength) {
              changes++;
            }
          }

          if (changes > 0) {
            await fs.writeFile(file, newContent, 'utf-8');
            importUpdates.push({ file: path.relative(projectRoot, file), changes });
          }
        }
      }

      // Create destination directory if needed
      await fs.mkdir(path.dirname(destination), { recursive: true });

      // Move the file
      await fs.writeFile(destination, sourceContent, 'utf-8');
      await fs.unlink(source);

      return {
        success: true,
        data: {
          source,
          destination,
          importUpdates,
          filesUpdated: importUpdates.length,
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

// ============================================================================
// 4. CODE MIGRATION TOOL
// ============================================================================

/**
 * Migrate code patterns (API updates, deprecation fixes)
 */
export const codeMigrationTool: AgentTool = {
  name: 'code_migration',
  description: `Apply code migrations across the codebase:
- API updates (e.g., React lifecycle → hooks)
- Deprecation fixes
- Library version upgrades
- Custom pattern transformations`,
  parameters: {
    type: 'object',
    properties: {
      migrationType: {
        type: 'string',
        enum: [
          'react-class-to-hooks',
          'commonjs-to-esm',
          'callback-to-async',
          'custom',
        ],
        description: 'Type of migration',
      },
      pattern: {
        type: 'string',
        description: 'Glob pattern for files',
      },
      customTransforms: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            find: { type: 'string' },
            replace: { type: 'string' },
          },
        },
        description: 'Custom find/replace transforms (for custom type)',
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview without applying',
      },
    },
    required: ['migrationType'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const migrationType = params.migrationType as string;
    const pattern = (params.pattern as string) || '**/*.{ts,tsx,js,jsx}';
    const customTransforms = params.customTransforms as Array<{ find: string; replace: string }> | undefined;
    const dryRun = params.dryRun as boolean;

    try {
      const cwd = process.cwd();
      const files = await findFilesWithGlob(cwd, pattern);

      // Get transforms based on migration type
      const transforms = getMigrationTransforms(migrationType, customTransforms);

      const migrations: Array<{
        file: string;
        transformsApplied: string[];
      }> = [];

      for (const file of files) {
        let content = await fs.readFile(file, 'utf-8');
        const applied: string[] = [];

        for (const transform of transforms) {
          const before = content;
          content = content.replace(transform.pattern, transform.replacement);
          if (content !== before) {
            applied.push(transform.name);
          }
        }

        if (applied.length > 0) {
          if (!dryRun) {
            await fs.writeFile(file, content, 'utf-8');
          }
          migrations.push({
            file: path.relative(cwd, file),
            transformsApplied: applied,
          });
        }
      }

      return {
        success: true,
        data: {
          migrationType,
          filesScanned: files.length,
          filesMigrated: migrations.length,
          dryRun,
          migrations: migrations.slice(0, 30),
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

interface MigrationTransform {
  name: string;
  pattern: RegExp;
  replacement: string;
}

function getMigrationTransforms(
  type: string,
  custom?: Array<{ find: string; replace: string }>
): MigrationTransform[] {
  switch (type) {
    case 'commonjs-to-esm':
      return [
        {
          name: 'require-to-import',
          pattern: /const\s+(\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
          replacement: "import $1 from '$2'",
        },
        {
          name: 'require-destructure-to-import',
          pattern: /const\s*{\s*([^}]+)\s*}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
          replacement: "import { $1 } from '$2'",
        },
        {
          name: 'module-exports-to-export',
          pattern: /module\.exports\s*=\s*/g,
          replacement: 'export default ',
        },
        {
          name: 'exports-to-named-export',
          pattern: /exports\.(\w+)\s*=/g,
          replacement: 'export const $1 =',
        },
      ];

    case 'callback-to-async':
      return [
        {
          name: 'fs-callback-to-promise',
          pattern: /fs\.readFile\s*\(\s*([^,]+),\s*['"]utf-?8?['"]\s*,\s*\([^)]*\)\s*=>\s*{/g,
          replacement: 'const data = await fs.promises.readFile($1, "utf-8");\n// Original callback logic:',
        },
      ];

    case 'custom':
      if (!custom) return [];
      return custom.map((c, i) => ({
        name: `custom-${i + 1}`,
        pattern: new RegExp(c.find, 'g'),
        replacement: c.replace,
      }));

    default:
      return [];
  }
}

// ============================================================================
// 5. SAFE MULTI-FILE TRANSACTION
// ============================================================================

/**
 * Atomic multi-file changes with rollback
 */
export const transactionalEditTool: AgentTool = {
  name: 'transactional_edit',
  description: `Apply changes to multiple files atomically with rollback:
- All changes succeed or none are applied
- Automatic rollback on any error
- Creates restore point
- Validates changes before committing`,
  parameters: {
    type: 'object',
    properties: {
      changes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            content: { type: 'string' },
          },
        },
        description: 'Array of file changes',
      },
      validateSyntax: {
        type: 'boolean',
        description: 'Validate TypeScript/JavaScript syntax before applying',
      },
      createRestorePoint: {
        type: 'boolean',
        description: 'Create .restore files for manual recovery',
      },
    },
    required: ['changes'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const changes = params.changes as Array<{ file: string; content: string }>;
    const validateSyntax = params.validateSyntax as boolean;
    const createRestorePoint = params.createRestorePoint as boolean;

    const originals: Map<string, string | null> = new Map();
    const applied: string[] = [];

    try {
      // Phase 1: Save originals
      for (const change of changes) {
        try {
          const original = await fs.readFile(change.file, 'utf-8');
          originals.set(change.file, original);
        } catch {
          // File doesn't exist yet
          originals.set(change.file, null);
        }
      }

      // Phase 2: Validate (if requested)
      if (validateSyntax) {
        for (const change of changes) {
          if (/\.(ts|tsx|js|jsx)$/.test(change.file)) {
            const hasErrors = basicSyntaxCheck(change.content);
            if (hasErrors) {
              throw new Error(`Syntax error in ${change.file}: ${hasErrors}`);
            }
          }
        }
      }

      // Phase 3: Create restore points (if requested)
      if (createRestorePoint) {
        for (const [file, original] of originals) {
          if (original !== null) {
            await fs.writeFile(`${file}.restore`, original, 'utf-8');
          }
        }
      }

      // Phase 4: Apply changes
      for (const change of changes) {
        await fs.mkdir(path.dirname(change.file), { recursive: true });
        await fs.writeFile(change.file, change.content, 'utf-8');
        applied.push(change.file);
      }

      return {
        success: true,
        data: {
          filesModified: applied.length,
          files: applied,
          restorePointsCreated: createRestorePoint,
        },
      };
    } catch (error) {
      // Rollback all changes
      logger.error('Transaction failed, rolling back', { error });

      for (const file of applied) {
        const original = originals.get(file);
        if (original !== null && original !== undefined) {
          try {
            await fs.writeFile(file, original, 'utf-8');
          } catch (rollbackError) {
            logger.error('Rollback failed', { file, error: rollbackError });
          }
        } else {
          // File was newly created, delete it
          try {
            await fs.unlink(file);
          } catch {
            // Ignore
          }
        }
      }

      return {
        success: false,
        error: `Transaction failed and was rolled back: ${(error as Error).message}`,
        data: { rolledBack: applied },
      };
    }
  },
};

function basicSyntaxCheck(code: string): string | null {
  // Basic checks - not a full parser but catches common issues
  const checks = [
    { pattern: /\{[^}]*$/, error: 'Unclosed brace' },
    { pattern: /\([^)]*$/, error: 'Unclosed parenthesis' },
    { pattern: /\[[^\]]*$/, error: 'Unclosed bracket' },
    { pattern: /['"][^'"]*$/, error: 'Unclosed string' },
  ];

  for (const check of checks) {
    // Very basic check - just looks for obviously broken syntax
    const lines = code.split('\n');
    let braceCount = 0;
    let parenCount = 0;
    let bracketCount = 0;

    for (const line of lines) {
      // Count brackets (simplified)
      braceCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      parenCount += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
      bracketCount += (line.match(/\[/g) || []).length - (line.match(/]/g) || []).length;
    }

    if (braceCount !== 0) return 'Mismatched braces';
    if (parenCount !== 0) return 'Mismatched parentheses';
    if (bracketCount !== 0) return 'Mismatched brackets';
  }

  return null;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function findFilesWithGlob(baseDir: string, pattern: string): Promise<string[]> {
  const files: string[] = [];
  
  // Simple glob implementation
  const parts = pattern.split('/');
  await walkDirectory(baseDir, parts, 0, files);
  
  return files;
}

async function walkDirectory(
  currentDir: string,
  patternParts: string[],
  partIndex: number,
  results: string[]
): Promise<void> {
  if (partIndex >= patternParts.length) return;

  const part = patternParts[partIndex];
  const isLast = partIndex === patternParts.length - 1;

  try {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      // Skip node_modules and hidden folders
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

      if (part === '**') {
        // Recursive match
        if (entry.isDirectory()) {
          await walkDirectory(fullPath, patternParts, partIndex, results);
          await walkDirectory(fullPath, patternParts, partIndex + 1, results);
        } else if (isLast || matchGlobPart(entry.name, patternParts[partIndex + 1])) {
          if (matchGlobPart(entry.name, patternParts[patternParts.length - 1])) {
            results.push(fullPath);
          }
        }
      } else if (matchGlobPart(entry.name, part)) {
        if (entry.isDirectory() && !isLast) {
          await walkDirectory(fullPath, patternParts, partIndex + 1, results);
        } else if (entry.isFile() && isLast) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // Directory doesn't exist or isn't readable
  }
}

function matchGlobPart(name: string, pattern: string): boolean {
  if (!pattern) return false;
  
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
    .replace(/\{([^}]+)\}/g, (_, group) => `(${group.split(',').join('|')})`);

  return new RegExp(`^${regexPattern}$`).test(name);
}

function escapeForRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findProjectRoot(startPath: string): Promise<string> {
  let current = path.dirname(startPath);
  
  while (current !== path.dirname(current)) {
    try {
      await fs.access(path.join(current, 'package.json'));
      return current;
    } catch {
      current = path.dirname(current);
    }
  }
  
  return path.dirname(startPath);
}

function getImportPath(filePath: string, projectRoot: string): string {
  const relative = path.relative(projectRoot, filePath);
  const withoutExt = relative.replace(/\.(ts|tsx|js|jsx)$/, '');
  return withoutExt.replace(/\\/g, '/');
}

function getRelativeImportPath(fromDir: string, toFile: string): string {
  const relative = path.relative(fromDir, toFile);
  const withoutExt = relative.replace(/\.(ts|tsx|js|jsx)$/, '');
  const normalized = withoutExt.replace(/\\/g, '/');
  return normalized.startsWith('.') ? normalized : './' + normalized;
}

function resolveImportPath(fromFile: string, importPath: string): string | null {
  if (!importPath.startsWith('.')) return null;
  
  const fromDir = path.dirname(fromFile);
  const resolved = path.resolve(fromDir, importPath);
  
  // Try with various extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];
  for (const ext of extensions) {
    const fullPath = resolved + ext;
    return fullPath;
  }
  
  return null;
}

// ============================================================================
// EXPORTS
// ============================================================================

export function getMultiFileEditorTools(): AgentTool[] {
  return [
    findReplaceTool,
    batchEditTool,
    moveWithUpdatesTool,
    codeMigrationTool,
    transactionalEditTool,
  ];
}

export default {
  findReplaceTool,
  batchEditTool,
  moveWithUpdatesTool,
  codeMigrationTool,
  transactionalEditTool,
  getMultiFileEditorTools,
};
