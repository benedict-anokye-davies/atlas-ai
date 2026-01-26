/**
 * @file Code Tools for the Coding Agent
 * @description Comprehensive tools for reading, writing, searching, and analyzing code
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';
import { promisify } from 'util';
import { createModuleLogger } from '../../utils/logger';
import { getErrorMessage, sleep, isoDateTime } from '../../../shared/utils';
import type {
  CodingTool,
  ToolResult,
  SearchResult,
  CodeError,
  SymbolInfo,
  SymbolKind,
  FileContext,
  GitStatus,
  LANGUAGE_MAP,
  DEFAULT_IGNORE_PATTERNS,
} from './types';

const logger = createModuleLogger('CodeTools');
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const readdirAsync = promisify(fs.readdir);
const statAsync = promisify(fs.stat);
const unlinkAsync = promisify(fs.unlink);
const renameAsync = promisify(fs.rename);
const mkdirAsync = promisify(fs.mkdir);
const existsAsync = promisify(fs.exists);

// Language extension mapping
const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.cpp': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sql': 'sql',
  '.sh': 'bash',
  '.ps1': 'powershell',
};

// Patterns to ignore during file traversal
const IGNORE_PATTERNS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
  '__pycache__',
  '.pytest_cache',
  'venv',
  '.venv',
  'target',
  '.idea',
]);

/**
 * Detect language from file extension
 */
function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return LANG_MAP[ext] || 'plaintext';
}

/**
 * Check if path should be ignored
 */
function shouldIgnore(filePath: string): boolean {
  const parts = filePath.split(path.sep);
  return parts.some(part => IGNORE_PATTERNS.has(part));
}

/**
 * Read file with line range support
 */
async function readFileWithRange(
  filePath: string,
  startLine?: number,
  endLine?: number
): Promise<{ content: string; totalLines: number }> {
  const content = await readFileAsync(filePath, 'utf-8');
  const lines = content.split('\n');
  const totalLines = lines.length;

  if (startLine !== undefined && endLine !== undefined) {
    const start = Math.max(0, startLine - 1);
    const end = Math.min(lines.length, endLine);
    return {
      content: lines.slice(start, end).join('\n'),
      totalLines,
    };
  }

  return { content, totalLines };
}

// =============================================================================
// TOOL: read_file
// =============================================================================

export const readFileTool: CodingTool = {
  name: 'read_file',
  description: `Read the contents of a file. You can optionally specify line ranges to read specific sections.
Use this to understand existing code before making changes. Prefer reading larger chunks to get full context.`,
  parameters: [
    {
      name: 'path',
      type: 'string',
      description: 'Absolute or relative path to the file to read',
      required: true,
    },
    {
      name: 'startLine',
      type: 'number',
      description: 'Line number to start reading from (1-indexed). Optional.',
      required: false,
    },
    {
      name: 'endLine',
      type: 'number',
      description: 'Line number to end reading at (inclusive, 1-indexed). Optional.',
      required: false,
    },
  ],
  dangerous: false,
  timeout: 10000,
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const filePath = params.path as string;
      const startLine = params.startLine as number | undefined;
      const endLine = params.endLine as number | undefined;

      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: `File not found: ${filePath}`,
          duration: Date.now() - startTime,
        };
      }

      const stat = await statAsync(filePath);
      if (stat.isDirectory()) {
        return {
          success: false,
          error: `Path is a directory, not a file: ${filePath}`,
          duration: Date.now() - startTime,
        };
      }

      // Check file size - warn if large
      const MAX_SIZE = 1024 * 1024; // 1MB
      if (stat.size > MAX_SIZE && !startLine && !endLine) {
        return {
          success: false,
          error: `File is too large (${(stat.size / 1024).toFixed(1)}KB). Please specify startLine and endLine to read a portion.`,
          duration: Date.now() - startTime,
        };
      }

      const { content, totalLines } = await readFileWithRange(filePath, startLine, endLine);
      const language = detectLanguage(filePath);

      let output = '';
      if (startLine && endLine) {
        output = `File: ${filePath} (lines ${startLine}-${endLine} of ${totalLines})\nLanguage: ${language}\n\n${content}`;
      } else {
        output = `File: ${filePath} (${totalLines} lines)\nLanguage: ${language}\n\n${content}`;
      }

      return {
        success: true,
        output,
        data: { content, totalLines, language },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: getErrorMessage(error),
        duration: Date.now() - startTime,
      };
    }
  },
};

// =============================================================================
// TOOL: create_file
// =============================================================================

export const createFileTool: CodingTool = {
  name: 'create_file',
  description: `Create a new file with the specified content. Parent directories will be created automatically.
Use this to create new files. Do NOT use for modifying existing files - use edit_file instead.`,
  parameters: [
    {
      name: 'path',
      type: 'string',
      description: 'Absolute or relative path for the new file',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'The content to write to the file',
      required: true,
    },
  ],
  dangerous: true,
  timeout: 10000,
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const filePath = params.path as string;
    const content = params.content as string;

    try {
      // Check if file already exists
      if (fs.existsSync(filePath)) {
        return {
          success: false,
          error: `File already exists: ${filePath}. Use edit_file to modify existing files.`,
          duration: Date.now() - startTime,
        };
      }

      // Create parent directories if needed
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        await mkdirAsync(dir, { recursive: true });
      }

      // Write the file
      await writeFileAsync(filePath, content, 'utf-8');

      const lines = content.split('\n').length;
      const language = detectLanguage(filePath);

      return {
        success: true,
        output: `Created file: ${filePath} (${lines} lines, ${language})`,
        filesAffected: [filePath],
        canRollback: true,
        rollback: async () => {
          if (fs.existsSync(filePath)) {
            await unlinkAsync(filePath);
            logger.info(`Rolled back: deleted ${filePath}`);
          }
        },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: getErrorMessage(error),
        duration: Date.now() - startTime,
      };
    }
  },
};

// =============================================================================
// TOOL: edit_file
// =============================================================================

export const editFileTool: CodingTool = {
  name: 'edit_file',
  description: `Make surgical edits to an existing file by replacing specific text.
CRITICAL: The oldText must EXACTLY match the text in the file, including whitespace and indentation.
Include 2-3 lines of context before and after the target text to ensure uniqueness.
If the oldText matches multiple locations, the edit will fail - add more context.`,
  parameters: [
    {
      name: 'path',
      type: 'string',
      description: 'Path to the file to edit',
      required: true,
    },
    {
      name: 'oldText',
      type: 'string',
      description:
        'The EXACT text to find and replace. Include surrounding context lines for uniqueness.',
      required: true,
    },
    {
      name: 'newText',
      type: 'string',
      description: 'The text to replace oldText with',
      required: true,
    },
  ],
  dangerous: true,
  timeout: 10000,
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const filePath = params.path as string;
    const oldText = params.oldText as string;
    const newText = params.newText as string;

    try {
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: `File not found: ${filePath}`,
          duration: Date.now() - startTime,
        };
      }

      const originalContent = await readFileAsync(filePath, 'utf-8');

      // Check how many times oldText appears
      const matches = originalContent.split(oldText).length - 1;

      if (matches === 0) {
        // Try to find similar text to help debug
        const oldLines = oldText.split('\n').filter(l => l.trim());
        const firstLine = oldLines[0]?.trim();
        const lastLine = oldLines[oldLines.length - 1]?.trim();

        let hint = '';
        if (firstLine && originalContent.includes(firstLine)) {
          hint = `\nHint: The first line "${firstLine.substring(0, 50)}..." exists in the file but the full match failed. Check whitespace/indentation.`;
        }

        return {
          success: false,
          error: `oldText not found in file.${hint}`,
          duration: Date.now() - startTime,
        };
      }

      if (matches > 1) {
        return {
          success: false,
          error: `oldText matches ${matches} locations in the file. Add more context to make it unique.`,
          duration: Date.now() - startTime,
        };
      }

      // Perform the replacement
      const newContent = originalContent.replace(oldText, newText);

      // Write the file
      await writeFileAsync(filePath, newContent, 'utf-8');

      // Calculate diff stats
      const oldLines = oldText.split('\n').length;
      const newLines = newText.split('\n').length;
      const diff = newLines - oldLines;

      return {
        success: true,
        output: `Edited ${filePath}: replaced ${oldLines} lines with ${newLines} lines (${diff >= 0 ? '+' : ''}${diff})`,
        filesAffected: [filePath],
        canRollback: true,
        data: { originalContent, newContent },
        rollback: async () => {
          await writeFileAsync(filePath, originalContent, 'utf-8');
          logger.info(`Rolled back: restored ${filePath}`);
        },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: getErrorMessage(error),
        duration: Date.now() - startTime,
      };
    }
  },
};

// =============================================================================
// TOOL: delete_file
// =============================================================================

export const deleteFileTool: CodingTool = {
  name: 'delete_file',
  description: `Delete a file from the filesystem. Use with caution. The file content will be saved for potential rollback.`,
  parameters: [
    {
      name: 'path',
      type: 'string',
      description: 'Path to the file to delete',
      required: true,
    },
  ],
  dangerous: true,
  timeout: 10000,
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const filePath = params.path as string;

    try {
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: `File not found: ${filePath}`,
          duration: Date.now() - startTime,
        };
      }

      const stat = await statAsync(filePath);
      if (stat.isDirectory()) {
        return {
          success: false,
          error: `Cannot delete directory with this tool: ${filePath}`,
          duration: Date.now() - startTime,
        };
      }

      // Save content for rollback
      const originalContent = await readFileAsync(filePath, 'utf-8');

      // Delete the file
      await unlinkAsync(filePath);

      return {
        success: true,
        output: `Deleted file: ${filePath}`,
        filesAffected: [filePath],
        canRollback: true,
        rollback: async () => {
          await writeFileAsync(filePath, originalContent, 'utf-8');
          logger.info(`Rolled back: restored ${filePath}`);
        },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: getErrorMessage(error),
        duration: Date.now() - startTime,
      };
    }
  },
};

// =============================================================================
// TOOL: list_directory
// =============================================================================

export const listDirectoryTool: CodingTool = {
  name: 'list_directory',
  description: `List files and directories in a given path. Use this to explore project structure.
Results show files and directories with '/' suffix for directories.
Common directories like node_modules, .git, dist are excluded by default.`,
  parameters: [
    {
      name: 'path',
      type: 'string',
      description: 'Path to the directory to list',
      required: true,
    },
    {
      name: 'recursive',
      type: 'boolean',
      description: 'Whether to list recursively. Default: false',
      required: false,
      default: false,
    },
    {
      name: 'maxDepth',
      type: 'number',
      description: 'Maximum depth for recursive listing. Default: 3',
      required: false,
      default: 3,
    },
  ],
  dangerous: false,
  timeout: 30000,
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const dirPath = params.path as string;
    const recursive = (params.recursive as boolean) ?? false;
    const maxDepth = (params.maxDepth as number) ?? 3;

    try {
      if (!fs.existsSync(dirPath)) {
        return {
          success: false,
          error: `Directory not found: ${dirPath}`,
          duration: Date.now() - startTime,
        };
      }

      const stat = await statAsync(dirPath);
      if (!stat.isDirectory()) {
        return {
          success: false,
          error: `Path is not a directory: ${dirPath}`,
          duration: Date.now() - startTime,
        };
      }

      const results: string[] = [];
      const MAX_FILES = 500;

      async function listDir(currentPath: string, depth: number, prefix: string): Promise<void> {
        if (depth > maxDepth || results.length >= MAX_FILES) return;

        const entries = await readdirAsync(currentPath, { withFileTypes: true });

        for (const entry of entries) {
          if (results.length >= MAX_FILES) break;
          if (shouldIgnore(entry.name)) continue;

          const fullPath = path.join(currentPath, entry.name);
          const relativePath = path.relative(dirPath, fullPath);

          if (entry.isDirectory()) {
            results.push(`${prefix}${relativePath}/`);
            if (recursive) {
              await listDir(fullPath, depth + 1, prefix);
            }
          } else {
            results.push(`${prefix}${relativePath}`);
          }
        }
      }

      await listDir(dirPath, 0, '');

      const output =
        results.length >= MAX_FILES
          ? `Directory: ${dirPath}\n(Showing first ${MAX_FILES} entries, more exist)\n\n${results.join('\n')}`
          : `Directory: ${dirPath}\n(${results.length} entries)\n\n${results.join('\n')}`;

      return {
        success: true,
        output,
        data: { entries: results, total: results.length },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: getErrorMessage(error),
        duration: Date.now() - startTime,
      };
    }
  },
};

// =============================================================================
// TOOL: grep_search
// =============================================================================

export const grepSearchTool: CodingTool = {
  name: 'grep_search',
  description: `Fast text search across files using pattern matching. Use for finding exact strings or regex patterns.
Returns matching lines with file paths and line numbers.
For semantic code understanding, prefer search_codebase instead.`,
  parameters: [
    {
      name: 'pattern',
      type: 'string',
      description: 'The pattern to search for (string or regex)',
      required: true,
    },
    {
      name: 'path',
      type: 'string',
      description: 'Directory to search in. Defaults to current working directory.',
      required: false,
    },
    {
      name: 'filePattern',
      type: 'string',
      description: 'Glob pattern to filter files (e.g., "*.ts", "*.{js,jsx}")',
      required: false,
    },
    {
      name: 'isRegex',
      type: 'boolean',
      description: 'Whether the pattern is a regex. Default: false',
      required: false,
      default: false,
    },
    {
      name: 'caseSensitive',
      type: 'boolean',
      description: 'Case sensitive search. Default: false',
      required: false,
      default: false,
    },
    {
      name: 'maxResults',
      type: 'number',
      description: 'Maximum number of results. Default: 100',
      required: false,
      default: 100,
    },
  ],
  dangerous: false,
  timeout: 60000,
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const pattern = params.pattern as string;
    const searchPath = (params.path as string) || process.cwd();
    const filePattern = params.filePattern as string | undefined;
    const isRegex = (params.isRegex as boolean) ?? false;
    const caseSensitive = (params.caseSensitive as boolean) ?? false;
    const maxResults = (params.maxResults as number) ?? 100;

    try {
      const results: SearchResult[] = [];
      const regex = isRegex
        ? new RegExp(pattern, caseSensitive ? 'g' : 'gi')
        : new RegExp(escapeRegex(pattern), caseSensitive ? 'g' : 'gi');

      // Check if file pattern matches
      function matchesFilePattern(filePath: string): boolean {
        if (!filePattern) return true;
        const patterns = filePattern.split(',').map(p => p.trim());
        const ext = path.extname(filePath);
        const basename = path.basename(filePath);

        return patterns.some(p => {
          if (p.startsWith('*.')) {
            return ext === p.substring(1) || ext === '.' + p.substring(2);
          }
          return basename.includes(p.replace('*', ''));
        });
      }

      async function searchDir(dirPath: string): Promise<void> {
        if (results.length >= maxResults) return;

        try {
          const entries = await readdirAsync(dirPath, { withFileTypes: true });

          for (const entry of entries) {
            if (results.length >= maxResults) break;
            if (shouldIgnore(entry.name)) continue;

            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
              await searchDir(fullPath);
            } else if (entry.isFile() && matchesFilePattern(fullPath)) {
              await searchFile(fullPath);
            }
          }
        } catch {
          // Skip directories we can't read
        }
      }

      async function searchFile(filePath: string): Promise<void> {
        try {
          const content = await readFileAsync(filePath, 'utf-8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length && results.length < maxResults; i++) {
            const line = lines[i];
            const matches = line.match(regex);

            if (matches) {
              // Get context lines
              const before = lines.slice(Math.max(0, i - 2), i);
              const after = lines.slice(i + 1, Math.min(lines.length, i + 3));

              results.push({
                file: filePath,
                line: i + 1,
                content: line,
                matchLength: matches[0].length,
                context: { before, after },
              });
            }
          }
        } catch {
          // Skip files we can't read
        }
      }

      if ((await statAsync(searchPath)).isFile()) {
        await searchFile(searchPath);
      } else {
        await searchDir(searchPath);
      }

      // Format output
      let output = `Search results for "${pattern}":\n`;
      output += `Found ${results.length} matches${results.length >= maxResults ? ` (limited to ${maxResults})` : ''}\n\n`;

      for (const result of results) {
        output += `${result.file}:${result.line}:\n`;
        output += `  ${result.content.trim()}\n\n`;
      }

      return {
        success: true,
        output,
        data: { results, total: results.length },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: getErrorMessage(error),
        duration: Date.now() - startTime,
      };
    }
  },
};

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =============================================================================
// TOOL: find_symbol
// =============================================================================

export const findSymbolTool: CodingTool = {
  name: 'find_symbol',
  description: `Find definitions and usages of a symbol (function, class, variable, etc.) in the codebase.
Useful for understanding how code is used and finding all references.`,
  parameters: [
    {
      name: 'symbol',
      type: 'string',
      description: 'The symbol name to search for',
      required: true,
    },
    {
      name: 'path',
      type: 'string',
      description: 'Directory to search in',
      required: false,
    },
    {
      name: 'type',
      type: 'string',
      description: 'Type of symbol to find: function, class, variable, interface, type, all',
      required: false,
      default: 'all',
      enum: ['function', 'class', 'variable', 'interface', 'type', 'all'],
    },
  ],
  dangerous: false,
  timeout: 60000,
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const symbol = params.symbol as string;
    const searchPath = (params.path as string) || process.cwd();
    const type = (params.type as string) || 'all';

    try {
      // Build regex patterns for different symbol types
      const patterns: { type: string; pattern: RegExp }[] = [];

      if (type === 'all' || type === 'function') {
        patterns.push({
          type: 'function',
          pattern: new RegExp(
            `(?:function\\s+${symbol}|const\\s+${symbol}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[^=])\\s*=>|${symbol}\\s*(?:=\\s*)?\\([^)]*\\)\\s*(?:=>|\\{))`,
            'g'
          ),
        });
      }

      if (type === 'all' || type === 'class') {
        patterns.push({
          type: 'class',
          pattern: new RegExp(`class\\s+${symbol}(?:\\s+extends|\\s+implements|\\s*\\{)`, 'g'),
        });
      }

      if (type === 'all' || type === 'interface') {
        patterns.push({
          type: 'interface',
          pattern: new RegExp(`interface\\s+${symbol}(?:\\s+extends|\\s*\\{)`, 'g'),
        });
      }

      if (type === 'all' || type === 'type') {
        patterns.push({
          type: 'type',
          pattern: new RegExp(`type\\s+${symbol}\\s*=`, 'g'),
        });
      }

      if (type === 'all' || type === 'variable') {
        patterns.push({
          type: 'variable',
          pattern: new RegExp(`(?:const|let|var)\\s+${symbol}\\s*[=:]`, 'g'),
        });
      }

      // Also find all usages
      const usagePattern = new RegExp(`\\b${escapeRegex(symbol)}\\b`, 'g');

      const definitions: { file: string; line: number; type: string; content: string }[] = [];
      const usages: { file: string; line: number; content: string }[] = [];

      async function searchDir(dirPath: string): Promise<void> {
        try {
          const entries = await readdirAsync(dirPath, { withFileTypes: true });

          for (const entry of entries) {
            if (shouldIgnore(entry.name)) continue;

            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
              await searchDir(fullPath);
            } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
              await searchFile(fullPath);
            }
          }
        } catch {
          // Skip
        }
      }

      async function searchFile(filePath: string): Promise<void> {
        try {
          const content = await readFileAsync(filePath, 'utf-8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Check for definitions
            for (const { type, pattern } of patterns) {
              if (pattern.test(line)) {
                definitions.push({
                  file: filePath,
                  line: i + 1,
                  type,
                  content: line.trim(),
                });
              }
              pattern.lastIndex = 0; // Reset regex
            }

            // Check for usages
            if (usagePattern.test(line)) {
              usages.push({
                file: filePath,
                line: i + 1,
                content: line.trim(),
              });
            }
            usagePattern.lastIndex = 0;
          }
        } catch {
          // Skip
        }
      }

      await searchDir(searchPath);

      // Format output
      let output = `Symbol: ${symbol}\n\n`;

      if (definitions.length > 0) {
        output += `Definitions (${definitions.length}):\n`;
        for (const def of definitions) {
          output += `  [${def.type}] ${def.file}:${def.line}\n`;
          output += `    ${def.content}\n`;
        }
        output += '\n';
      }

      output += `Usages (${usages.length}):\n`;
      const uniqueUsages = usages.slice(0, 50); // Limit output
      for (const usage of uniqueUsages) {
        output += `  ${usage.file}:${usage.line}\n`;
        output += `    ${usage.content}\n`;
      }

      if (usages.length > 50) {
        output += `  ... and ${usages.length - 50} more usages\n`;
      }

      return {
        success: true,
        output,
        data: { definitions, usages: usages.slice(0, 100) },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: getErrorMessage(error),
        duration: Date.now() - startTime,
      };
    }
  },
};

// =============================================================================
// TOOL: get_errors
// =============================================================================

export const getErrorsTool: CodingTool = {
  name: 'get_errors',
  description: `Get TypeScript/JavaScript compilation errors and linting issues from the project.
Run this after making changes to verify they compile correctly.
Also useful before making changes to understand existing issues.`,
  parameters: [
    {
      name: 'path',
      type: 'string',
      description: 'Directory or file to check. Defaults to current directory.',
      required: false,
    },
  ],
  dangerous: false,
  timeout: 120000,
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const checkPath = (params.path as string) || process.cwd();

    try {
      const errors: CodeError[] = [];

      // Try running tsc
      try {
        execSync('npx tsc --noEmit 2>&1', {
          cwd: checkPath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 60000,
        });
      } catch (e) {
        const output = (e as { stdout?: string }).stdout || '';
        const lines = output.split('\n');

        // Parse TypeScript errors: path(line,col): error TS1234: message
        const errorRegex = /^(.+)\((\d+),(\d+)\):\s*(error|warning)\s*(TS\d+):\s*(.+)$/;

        for (const line of lines) {
          const match = line.match(errorRegex);
          if (match) {
            errors.push({
              file: match[1],
              line: parseInt(match[2], 10),
              column: parseInt(match[3], 10),
              severity: match[4] as 'error' | 'warning',
              code: match[5],
              message: match[6],
              source: 'typescript',
            });
          }
        }
      }

      // Format output
      if (errors.length === 0) {
        return {
          success: true,
          output: 'No errors found. Code compiles successfully.',
          data: { errors: [] },
          duration: Date.now() - startTime,
        };
      }

      let output = `Found ${errors.length} issues:\n\n`;

      // Group by file
      const byFile = new Map<string, CodeError[]>();
      for (const error of errors) {
        const existing = byFile.get(error.file) || [];
        existing.push(error);
        byFile.set(error.file, existing);
      }

      for (const [file, fileErrors] of byFile) {
        output += `${file}:\n`;
        for (const error of fileErrors) {
          output += `  Line ${error.line}: [${error.severity}] ${error.message} (${error.code})\n`;
        }
        output += '\n';
      }

      return {
        success: true,
        output,
        data: { errors },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: getErrorMessage(error),
        duration: Date.now() - startTime,
      };
    }
  },
};

// =============================================================================
// TOOL: run_command
// =============================================================================

export const runCommandTool: CodingTool = {
  name: 'run_command',
  description: `Run a shell command in the terminal. Use for building, testing, running scripts, etc.
Commands run with a timeout and output is captured.
SECURITY: Certain dangerous commands are blocked (rm -rf /, format, etc.)`,
  parameters: [
    {
      name: 'command',
      type: 'string',
      description: 'The command to run',
      required: true,
    },
    {
      name: 'cwd',
      type: 'string',
      description: 'Working directory. Defaults to project root.',
      required: false,
    },
    {
      name: 'timeout',
      type: 'number',
      description: 'Timeout in milliseconds. Default: 60000 (60s)',
      required: false,
      default: 60000,
    },
  ],
  dangerous: true,
  timeout: 120000,
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const command = params.command as string;
    const cwd = (params.cwd as string) || process.cwd();
    const timeout = (params.timeout as number) || 60000;

    // Security checks
    const dangerousPatterns = [
      /rm\s+-rf\s+[\/\\]/i,
      /format\s+[a-z]:/i,
      /mkfs/i,
      /dd\s+if=/i,
      /:\(\)\{:\|:&\};:/,
      />\s*\/dev\/sd/i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return {
          success: false,
          error: `Command blocked for security: potentially destructive operation detected.`,
          duration: Date.now() - startTime,
        };
      }
    }

    try {
      const output = execSync(command, {
        cwd,
        encoding: 'utf-8',
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      return {
        success: true,
        output: `$ ${command}\n\n${output}`,
        duration: Date.now() - startTime,
      };
    } catch (e) {
      const error = e as { stdout?: string; stderr?: string; status?: number };
      const stdout = error.stdout || '';
      const stderr = error.stderr || '';
      const exitCode = error.status || 1;

      return {
        success: false,
        output: `$ ${command}\n\n${stdout}${stderr ? '\n[stderr]\n' + stderr : ''}`,
        error: `Command exited with code ${exitCode}`,
        duration: Date.now() - startTime,
      };
    }
  },
};

// =============================================================================
// TOOL: git_status
// =============================================================================

export const gitStatusTool: CodingTool = {
  name: 'git_status',
  description: `Get the current git status including branch, staged files, unstaged changes, and untracked files.`,
  parameters: [
    {
      name: 'path',
      type: 'string',
      description: 'Repository path. Defaults to current directory.',
      required: false,
    },
  ],
  dangerous: false,
  timeout: 30000,
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const repoPath = (params.path as string) || process.cwd();

    try {
      // Get branch
      const branch = execSync('git branch --show-current', {
        cwd: repoPath,
        encoding: 'utf-8',
      }).trim();

      // Get status
      const statusOutput = execSync('git status --porcelain', {
        cwd: repoPath,
        encoding: 'utf-8',
      });

      const staged: string[] = [];
      const unstaged: string[] = [];
      const untracked: string[] = [];

      for (const line of statusOutput.split('\n').filter(Boolean)) {
        const index = line[0];
        const working = line[1];
        const file = line.substring(3);

        if (index === '?') {
          untracked.push(file);
        } else if (index !== ' ') {
          staged.push(file);
        }
        if (working !== ' ' && working !== '?') {
          unstaged.push(file);
        }
      }

      // Get ahead/behind
      let ahead = 0;
      let behind = 0;
      try {
        const tracking = execSync('git rev-list --left-right --count HEAD...@{upstream} 2>/dev/null', {
          cwd: repoPath,
          encoding: 'utf-8',
        }).trim();
        const [a, b] = tracking.split('\t').map(Number);
        ahead = a || 0;
        behind = b || 0;
      } catch {
        // No upstream configured
      }

      const status: GitStatus = {
        branch,
        clean: staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
        ahead,
        behind,
        staged,
        unstaged,
        untracked,
      };

      let output = `Branch: ${branch}`;
      if (ahead || behind) {
        output += ` (ahead ${ahead}, behind ${behind})`;
      }
      output += '\n\n';

      if (status.clean) {
        output += 'Working tree clean.';
      } else {
        if (staged.length > 0) {
          output += `Staged (${staged.length}):\n  ${staged.join('\n  ')}\n\n`;
        }
        if (unstaged.length > 0) {
          output += `Unstaged (${unstaged.length}):\n  ${unstaged.join('\n  ')}\n\n`;
        }
        if (untracked.length > 0) {
          output += `Untracked (${untracked.length}):\n  ${untracked.join('\n  ')}\n`;
        }
      }

      return {
        success: true,
        output,
        data: status,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: getErrorMessage(error),
        duration: Date.now() - startTime,
      };
    }
  },
};

// =============================================================================
// TOOL: git_diff
// =============================================================================

export const gitDiffTool: CodingTool = {
  name: 'git_diff',
  description: `Show git diff for files. Can show staged changes, unstaged changes, or diff between commits.`,
  parameters: [
    {
      name: 'path',
      type: 'string',
      description: 'Repository or file path. Defaults to current directory.',
      required: false,
    },
    {
      name: 'staged',
      type: 'boolean',
      description: 'Show staged changes. Default: false (shows unstaged)',
      required: false,
      default: false,
    },
    {
      name: 'commit',
      type: 'string',
      description: 'Compare against a specific commit or range (e.g., HEAD~3, main..feature)',
      required: false,
    },
  ],
  dangerous: false,
  timeout: 30000,
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const repoPath = (params.path as string) || process.cwd();
    const staged = params.staged as boolean;
    const commit = params.commit as string | undefined;

    try {
      let cmd = 'git diff';
      if (staged) {
        cmd += ' --staged';
      }
      if (commit) {
        cmd += ` ${commit}`;
      }
      cmd += ' --color=never';

      const output = execSync(cmd, {
        cwd: repoPath,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });

      if (!output.trim()) {
        return {
          success: true,
          output: staged ? 'No staged changes.' : 'No unstaged changes.',
          duration: Date.now() - startTime,
        };
      }

      return {
        success: true,
        output,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: getErrorMessage(error),
        duration: Date.now() - startTime,
      };
    }
  },
};

// =============================================================================
// TOOL REGISTRY
// =============================================================================

/** All available coding tools */
export const CODING_TOOLS: CodingTool[] = [
  readFileTool,
  createFileTool,
  editFileTool,
  deleteFileTool,
  listDirectoryTool,
  grepSearchTool,
  findSymbolTool,
  getErrorsTool,
  runCommandTool,
  gitStatusTool,
  gitDiffTool,
];

/** Get a tool by name */
export function getToolByName(name: string): CodingTool | undefined {
  return CODING_TOOLS.find(t => t.name === name);
}

/** Get tool definitions for LLM prompt */
export function getToolDefinitions(): string {
  return CODING_TOOLS.map(tool => {
    const params = tool.parameters
      .map(p => {
        let def = `    - ${p.name} (${p.type}${p.required ? ', required' : ', optional'}): ${p.description}`;
        if (p.default !== undefined) {
          def += ` Default: ${p.default}`;
        }
        if (p.enum) {
          def += ` Values: ${p.enum.join(', ')}`;
        }
        return def;
      })
      .join('\n');

    return `${tool.name}:
  ${tool.description}
  Parameters:
${params}`;
  }).join('\n\n');
}

export default CODING_TOOLS;
