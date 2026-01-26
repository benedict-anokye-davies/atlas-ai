/**
 * @file Context Builder for the Coding Agent
 * @description Intelligent context gathering - project structure, dependencies, symbols
 */

import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { createModuleLogger } from '../../utils/logger';
import { getErrorMessage } from '../../../shared/utils';
import type {
  ProjectContext,
  FileContext,
  CodingContext,
  CodeError,
  SymbolInfo,
  SymbolKind,
  SearchResult,
  GitStatus,
  ConversationMessage,
} from './types';

const logger = createModuleLogger('ContextBuilder');
const readFileAsync = promisify(fs.readFile);
const readdirAsync = promisify(fs.readdir);
const statAsync = promisify(fs.stat);

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
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.html': 'html',
  '.css': 'css',
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
 * Context Builder for intelligent code understanding
 */
export class ContextBuilder {
  private projectRoot: string;
  private projectContext?: ProjectContext;
  private fileCache = new Map<string, FileContext>();
  private symbolCache = new Map<string, SymbolInfo[]>();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Build complete coding context for a request
   */
  async buildContext(request: {
    userRequest: string;
    files?: string[];
    includeGit?: boolean;
    includeErrors?: boolean;
  }): Promise<CodingContext> {
    logger.info('Building coding context', { userRequest: request.userRequest.substring(0, 100) });

    // Get or build project context
    if (!this.projectContext) {
      this.projectContext = await this.analyzeProject();
    }

    // Gather relevant files
    const activeFiles: FileContext[] = [];

    // Include explicitly requested files
    if (request.files) {
      for (const file of request.files) {
        const fileContext = await this.getFileContext(file);
        if (fileContext) {
          activeFiles.push(fileContext);
        }
      }
    }

    // Find related files based on the request
    const relatedFiles = await this.findRelatedFiles(request.userRequest);
    for (const file of relatedFiles) {
      if (!activeFiles.find(f => f.path === file)) {
        const fileContext = await this.getFileContext(file);
        if (fileContext) {
          activeFiles.push(fileContext);
        }
      }
    }

    // Get errors if requested
    const errors: CodeError[] = request.includeErrors
      ? await this.getProjectErrors()
      : [];

    // Get git status if requested
    const gitStatus = request.includeGit
      ? await this.getGitStatus()
      : undefined;

    return {
      project: this.projectContext,
      activeFiles,
      recentFiles: this.getRecentFiles(),
      errors,
      gitStatus,
      userRequest: request.userRequest,
      conversationHistory: [],
    };
  }

  /**
   * Analyze the project structure
   */
  async analyzeProject(): Promise<ProjectContext> {
    logger.info('Analyzing project structure', { root: this.projectRoot });

    const context: ProjectContext = {
      root: this.projectRoot,
      language: 'typescript',
      configFiles: [],
      sourceDirs: [],
      testDirs: [],
      outputDirs: [],
      ignorePatterns: [],
    };

    // Detect package.json
    const packageJsonPath = path.join(this.projectRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(await readFileAsync(packageJsonPath, 'utf-8'));
        context.name = packageJson.name;
        context.configFiles.push('package.json');

        // Detect package manager
        if (fs.existsSync(path.join(this.projectRoot, 'pnpm-lock.yaml'))) {
          context.packageManager = 'pnpm';
        } else if (fs.existsSync(path.join(this.projectRoot, 'yarn.lock'))) {
          context.packageManager = 'yarn';
        } else if (fs.existsSync(path.join(this.projectRoot, 'bun.lockb'))) {
          context.packageManager = 'bun';
        } else {
          context.packageManager = 'npm';
        }

        // Detect framework from dependencies
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        if (deps['next']) {
          context.framework = 'next.js';
        } else if (deps['electron']) {
          context.framework = 'electron';
        } else if (deps['react']) {
          context.framework = 'react';
        } else if (deps['vue']) {
          context.framework = 'vue';
        } else if (deps['angular']) {
          context.framework = 'angular';
        } else if (deps['express']) {
          context.framework = 'express';
        }
      } catch (e) {
        logger.warn('Failed to parse package.json', { error: getErrorMessage(e) });
      }
    }

    // Detect TypeScript
    if (fs.existsSync(path.join(this.projectRoot, 'tsconfig.json'))) {
      context.language = 'typescript';
      context.configFiles.push('tsconfig.json');
    }

    // Detect Python
    if (fs.existsSync(path.join(this.projectRoot, 'pyproject.toml'))) {
      context.language = 'python';
      context.configFiles.push('pyproject.toml');
    } else if (fs.existsSync(path.join(this.projectRoot, 'requirements.txt'))) {
      context.language = 'python';
      context.configFiles.push('requirements.txt');
    }

    // Detect Rust
    if (fs.existsSync(path.join(this.projectRoot, 'Cargo.toml'))) {
      context.language = 'rust';
      context.configFiles.push('Cargo.toml');
    }

    // Detect Go
    if (fs.existsSync(path.join(this.projectRoot, 'go.mod'))) {
      context.language = 'go';
      context.configFiles.push('go.mod');
    }

    // Common config files
    const configPatterns = [
      'vite.config.ts',
      'vite.config.js',
      'webpack.config.js',
      'rollup.config.js',
      '.eslintrc.js',
      '.eslintrc.json',
      '.prettierrc',
      'jest.config.js',
      'vitest.config.ts',
      'tailwind.config.js',
    ];

    for (const pattern of configPatterns) {
      if (fs.existsSync(path.join(this.projectRoot, pattern))) {
        context.configFiles.push(pattern);
      }
    }

    // Detect source directories
    const commonSourceDirs = ['src', 'lib', 'app', 'pages', 'components'];
    for (const dir of commonSourceDirs) {
      const dirPath = path.join(this.projectRoot, dir);
      if (fs.existsSync(dirPath) && (await statAsync(dirPath)).isDirectory()) {
        context.sourceDirs.push(dir);
      }
    }

    // Detect test directories
    const commonTestDirs = ['tests', 'test', '__tests__', 'spec'];
    for (const dir of commonTestDirs) {
      const dirPath = path.join(this.projectRoot, dir);
      if (fs.existsSync(dirPath) && (await statAsync(dirPath)).isDirectory()) {
        context.testDirs.push(dir);
      }
    }

    // Detect output directories
    const commonOutputDirs = ['dist', 'build', 'out', '.next', 'coverage'];
    for (const dir of commonOutputDirs) {
      const dirPath = path.join(this.projectRoot, dir);
      if (fs.existsSync(dirPath) && (await statAsync(dirPath)).isDirectory()) {
        context.outputDirs.push(dir);
      }
    }

    // Read .gitignore for ignore patterns
    const gitignorePath = path.join(this.projectRoot, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const gitignore = await readFileAsync(gitignorePath, 'utf-8');
      context.ignorePatterns = gitignore
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
    }

    logger.info('Project analysis complete', {
      name: context.name,
      language: context.language,
      framework: context.framework,
      sourceDirs: context.sourceDirs.length,
    });

    return context;
  }

  /**
   * Get context for a single file
   */
  async getFileContext(filePath: string): Promise<FileContext | null> {
    // Resolve to absolute path
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.projectRoot, filePath);

    // Check cache
    if (this.fileCache.has(absolutePath)) {
      return this.fileCache.get(absolutePath)!;
    }

    try {
      if (!fs.existsSync(absolutePath)) {
        return null;
      }

      const stat = await statAsync(absolutePath);
      if (!stat.isFile()) {
        return null;
      }

      const content = await readFileAsync(absolutePath, 'utf-8');
      const ext = path.extname(absolutePath).toLowerCase();
      const language = LANG_MAP[ext] || 'plaintext';
      const lines = content.split('\n').length;

      // Extract symbols for source files
      let symbols: SymbolInfo[] | undefined;
      if (['typescript', 'javascript'].includes(language)) {
        symbols = this.extractSymbols(content, absolutePath);
      }

      // Extract dependencies
      const dependencies = this.extractDependencies(content, absolutePath);

      const fileContext: FileContext = {
        path: absolutePath,
        relativePath: path.relative(this.projectRoot, absolutePath),
        content,
        language,
        size: stat.size,
        lastModified: stat.mtime,
        lines,
        symbols,
        dependencies,
      };

      // Cache the result
      this.fileCache.set(absolutePath, fileContext);

      return fileContext;
    } catch (e) {
      logger.warn('Failed to get file context', { file: filePath, error: getErrorMessage(e) });
      return null;
    }
  }

  /**
   * Extract symbols from TypeScript/JavaScript code
   */
  private extractSymbols(content: string, filePath: string): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];
    const lines = content.split('\n');

    const patterns: { kind: SymbolKind; regex: RegExp }[] = [
      // Functions
      { kind: 'function', regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m },
      // Arrow functions
      { kind: 'function', regex: /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/m },
      // Classes
      { kind: 'class', regex: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/m },
      // Interfaces
      { kind: 'interface', regex: /^(?:export\s+)?interface\s+(\w+)/m },
      // Types
      { kind: 'type', regex: /^(?:export\s+)?type\s+(\w+)\s*=/m },
      // Enums
      { kind: 'enum', regex: /^(?:export\s+)?enum\s+(\w+)/m },
      // Constants (module level)
      { kind: 'constant', regex: /^(?:export\s+)?const\s+(\w+)\s*=/m },
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const { kind, regex } of patterns) {
        const match = line.match(regex);
        if (match) {
          // Find the end of the definition (rough heuristic)
          let endLine = i;
          let braceCount = 0;
          let started = false;

          for (let j = i; j < lines.length && j < i + 500; j++) {
            const checkLine = lines[j];
            for (const char of checkLine) {
              if (char === '{' || char === '(') {
                braceCount++;
                started = true;
              } else if (char === '}' || char === ')') {
                braceCount--;
              }
            }
            if (started && braceCount <= 0) {
              endLine = j;
              break;
            }
          }

          symbols.push({
            name: match[1],
            kind,
            location: {
              file: filePath,
              startLine: i + 1,
              endLine: endLine + 1,
            },
            signature: line.trim(),
          });
        }
      }
    }

    return symbols;
  }

  /**
   * Extract import dependencies from code
   */
  private extractDependencies(content: string, _filePath: string): string[] {
    const dependencies: string[] = [];

    // Match ES imports
    const importRegex = /import\s+(?:[\w{}\s,*]+from\s+)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      dependencies.push(match[1]);
    }

    // Match requires
    const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      dependencies.push(match[1]);
    }

    return [...new Set(dependencies)];
  }

  /**
   * Find files related to a user request
   */
  async findRelatedFiles(request: string): Promise<string[]> {
    const relatedFiles: string[] = [];
    const maxFiles = 10;

    // Extract potential file names from the request
    const filePatterns = [
      /['"]([^'"]+\.[a-z]+)['"]/gi, // Quoted file names
      /(\w+\.[a-z]{2,4})\b/gi, // File.ext pattern
      /(\w+(?:\/\w+)+)\b/gi, // Path patterns
    ];

    const mentioned = new Set<string>();
    for (const pattern of filePatterns) {
      let match;
      while ((match = pattern.exec(request)) !== null) {
        mentioned.add(match[1].toLowerCase());
      }
    }

    // Search for mentioned files
    for (const mention of mentioned) {
      const found = await this.findFileByName(mention);
      if (found && relatedFiles.length < maxFiles) {
        relatedFiles.push(found);
      }
    }

    // Extract keywords for semantic matching
    const keywords = request
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 3)
      .filter(w => !['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'will'].includes(w));

    // Search for files containing keywords in their name
    if (relatedFiles.length < maxFiles && keywords.length > 0) {
      const candidates = await this.searchFilesByKeywords(keywords, maxFiles - relatedFiles.length);
      for (const candidate of candidates) {
        if (!relatedFiles.includes(candidate)) {
          relatedFiles.push(candidate);
        }
      }
    }

    return relatedFiles;
  }

  /**
   * Find a file by name pattern
   */
  private async findFileByName(pattern: string): Promise<string | null> {
    const normalizedPattern = pattern.toLowerCase().replace(/\\/g, '/');

    async function searchDir(dirPath: string): Promise<string | null> {
      try {
        const entries = await readdirAsync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          if (IGNORE_PATTERNS.has(entry.name)) continue;

          const fullPath = path.join(dirPath, entry.name);
          const relativePath = path.relative(process.cwd(), fullPath).toLowerCase().replace(/\\/g, '/');

          if (entry.isFile()) {
            if (
              relativePath.endsWith(normalizedPattern) ||
              entry.name.toLowerCase() === normalizedPattern
            ) {
              return fullPath;
            }
          } else if (entry.isDirectory()) {
            const found = await searchDir(fullPath);
            if (found) return found;
          }
        }
      } catch {
        // Skip inaccessible directories
      }
      return null;
    }

    return searchDir(this.projectRoot);
  }

  /**
   * Search for files by keywords
   */
  private async searchFilesByKeywords(keywords: string[], limit: number): Promise<string[]> {
    const results: string[] = [];

    async function searchDir(dirPath: string): Promise<void> {
      if (results.length >= limit) return;

      try {
        const entries = await readdirAsync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          if (results.length >= limit) break;
          if (IGNORE_PATTERNS.has(entry.name)) continue;

          const fullPath = path.join(dirPath, entry.name);
          const nameLower = entry.name.toLowerCase();

          if (entry.isFile()) {
            // Check if file name contains any keyword
            for (const keyword of keywords) {
              if (nameLower.includes(keyword)) {
                results.push(fullPath);
                break;
              }
            }
          } else if (entry.isDirectory()) {
            await searchDir(fullPath);
          }
        }
      } catch {
        // Skip
      }
    }

    await searchDir(this.projectRoot);
    return results;
  }

  /**
   * Get TypeScript errors in the project
   */
  private async getProjectErrors(): Promise<CodeError[]> {
    const { execSync } = require('child_process');
    const errors: CodeError[] = [];

    try {
      execSync('npx tsc --noEmit 2>&1', {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        timeout: 60000,
      });
    } catch (e) {
      const output = (e as { stdout?: string }).stdout || '';
      const errorRegex = /^(.+)\((\d+),(\d+)\):\s*(error|warning)\s*(TS\d+):\s*(.+)$/gm;

      let match;
      while ((match = errorRegex.exec(output)) !== null) {
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

    return errors;
  }

  /**
   * Get git status
   */
  private async getGitStatus(): Promise<GitStatus | undefined> {
    const { execSync } = require('child_process');

    try {
      const branch = execSync('git branch --show-current', {
        cwd: this.projectRoot,
        encoding: 'utf-8',
      }).trim();

      const statusOutput = execSync('git status --porcelain', {
        cwd: this.projectRoot,
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

      return {
        branch,
        clean: staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
        ahead: 0,
        behind: 0,
        staged,
        unstaged,
        untracked,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Get recent files (placeholder - would integrate with file watcher)
   */
  private getRecentFiles(): string[] {
    return Array.from(this.fileCache.keys()).slice(0, 10);
  }

  /**
   * Clear caches
   */
  clearCache(): void {
    this.fileCache.clear();
    this.symbolCache.clear();
    this.projectContext = undefined;
  }

  /**
   * Get summary of the context for LLM
   */
  getContextSummary(context: CodingContext): string {
    let summary = `# Project Context\n\n`;

    // Project info
    summary += `## Project: ${context.project.name || 'Unknown'}\n`;
    summary += `- Language: ${context.project.language}\n`;
    if (context.project.framework) {
      summary += `- Framework: ${context.project.framework}\n`;
    }
    summary += `- Package Manager: ${context.project.packageManager || 'unknown'}\n`;
    summary += `- Source Directories: ${context.project.sourceDirs.join(', ') || 'N/A'}\n\n`;

    // Active files
    if (context.activeFiles.length > 0) {
      summary += `## Active Files (${context.activeFiles.length})\n`;
      for (const file of context.activeFiles) {
        summary += `- ${file.relativePath} (${file.language}, ${file.lines} lines)\n`;
        if (file.symbols && file.symbols.length > 0) {
          summary += `  Symbols: ${file.symbols.map(s => `${s.name} (${s.kind})`).join(', ')}\n`;
        }
      }
      summary += '\n';
    }

    // Errors
    if (context.errors.length > 0) {
      summary += `## Errors (${context.errors.length})\n`;
      const byFile = new Map<string, CodeError[]>();
      for (const error of context.errors) {
        const existing = byFile.get(error.file) || [];
        existing.push(error);
        byFile.set(error.file, existing);
      }

      for (const [file, errors] of byFile) {
        summary += `### ${file}\n`;
        for (const error of errors.slice(0, 5)) {
          summary += `- Line ${error.line}: ${error.message}\n`;
        }
        if (errors.length > 5) {
          summary += `  ... and ${errors.length - 5} more\n`;
        }
      }
      summary += '\n';
    }

    // Git status
    if (context.gitStatus) {
      summary += `## Git Status\n`;
      summary += `- Branch: ${context.gitStatus.branch}\n`;
      summary += `- Clean: ${context.gitStatus.clean}\n`;
      if (context.gitStatus.staged.length > 0) {
        summary += `- Staged: ${context.gitStatus.staged.length} files\n`;
      }
      if (context.gitStatus.unstaged.length > 0) {
        summary += `- Unstaged: ${context.gitStatus.unstaged.length} files\n`;
      }
      summary += '\n';
    }

    return summary;
  }
}

// Singleton instance
let contextBuilderInstance: ContextBuilder | null = null;

/**
 * Get the context builder instance
 */
export function getContextBuilder(projectRoot?: string): ContextBuilder {
  if (!contextBuilderInstance || (projectRoot && contextBuilderInstance['projectRoot'] !== projectRoot)) {
    contextBuilderInstance = new ContextBuilder(projectRoot || process.cwd());
  }
  return contextBuilderInstance;
}

export default ContextBuilder;
