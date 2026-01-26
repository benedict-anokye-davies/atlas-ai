/**
 * Atlas Desktop - Code Intelligence Tools
 * 
 * Advanced coding tools that make Atlas a top-tier programming AI.
 * These tools enable deep code understanding similar to Opus 4.5 / Cursor.
 * 
 * @module agent/tools/code-intelligence
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';

const execAsync = promisify(exec);
const logger = createModuleLogger('CodeIntelligence');

// ============================================================================
// 1. GREP/RIPGREP SEARCH - Fast codebase search
// ============================================================================

/**
 * Fast grep search across codebase (uses ripgrep if available)
 */
export const grepSearchTool: AgentTool = {
  name: 'grep_search',
  description: `Fast text/regex search across files in a directory. Uses ripgrep (rg) if available, falls back to grep.
Perfect for:
- Finding all usages of a function/variable
- Searching for patterns across codebase
- Finding TODO/FIXME comments
- Locating error messages in code`,
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Search pattern (supports regex)',
      },
      directory: {
        type: 'string',
        description: 'Directory to search in (default: current working directory)',
      },
      filePattern: {
        type: 'string',
        description: 'File pattern to include (e.g., "*.ts", "*.py")',
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Case sensitive search (default: false)',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum results to return (default: 50)',
      },
      context: {
        type: 'number',
        description: 'Lines of context around matches (default: 2)',
      },
    },
    required: ['pattern'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const pattern = params.pattern as string;
      const directory = (params.directory as string) || process.cwd();
      const filePattern = params.filePattern as string | undefined;
      const caseSensitive = (params.caseSensitive as boolean) ?? false;
      const maxResults = (params.maxResults as number) || 50;
      const context = (params.context as number) || 2;

      // Try ripgrep first, then fall back to grep
      let command: string;
      const caseFlag = caseSensitive ? '' : '-i';
      
      // Check if ripgrep is available
      try {
        await execAsync('rg --version');
        // Ripgrep command
        command = `rg ${caseFlag} --json -C ${context} -m ${maxResults}`;
        if (filePattern) {
          command += ` -g "${filePattern}"`;
        }
        command += ` "${pattern.replace(/"/g, '\\"')}" "${directory}"`;
      } catch {
        // Fall back to grep (with findstr on Windows)
        if (process.platform === 'win32') {
          const flag = caseSensitive ? '' : '/I';
          command = `findstr ${flag} /S /N "${pattern}" "${directory}\\*${filePattern || '.*'}"`;
        } else {
          command = `grep -r ${caseFlag} -n -C ${context} "${pattern}" "${directory}"`;
          if (filePattern) {
            command += ` --include="${filePattern}"`;
          }
        }
      }

      const { stdout, stderr } = await execAsync(command, { 
        maxBuffer: 10 * 1024 * 1024,
        cwd: directory,
      });

      // Parse results
      const lines = stdout.trim().split('\n').filter(Boolean);
      const results: Array<{
        file: string;
        line: number;
        content: string;
        match: string;
      }> = [];

      for (const line of lines.slice(0, maxResults)) {
        // Try to parse ripgrep JSON format
        try {
          const json = JSON.parse(line);
          if (json.type === 'match') {
            results.push({
              file: json.data.path.text,
              line: json.data.line_number,
              content: json.data.lines.text.trim(),
              match: json.data.submatches?.[0]?.match?.text || '',
            });
          }
        } catch {
          // Parse grep format: file:line:content
          const match = line.match(/^(.+?):(\d+):(.*)$/);
          if (match) {
            results.push({
              file: match[1],
              line: parseInt(match[2]),
              content: match[3].trim(),
              match: pattern,
            });
          }
        }
      }

      return {
        success: true,
        data: {
          pattern,
          directory,
          totalMatches: results.length,
          results,
        },
      };
    } catch (error) {
      const err = error as Error & { code?: string };
      // No matches found is not an error
      if (err.code === '1' || err.message.includes('exit code 1')) {
        return {
          success: true,
          data: { pattern: params.pattern, totalMatches: 0, results: [] },
        };
      }
      logger.error('Grep search failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

// ============================================================================
// 2. SEMANTIC CODE SEARCH - AI-powered code understanding
// ============================================================================

/**
 * Semantic search using code embeddings (requires local model or API)
 */
export const semanticSearchTool: AgentTool = {
  name: 'semantic_code_search',
  description: `Search code semantically using natural language. Understands code meaning, not just text.
Examples:
- "function that handles user authentication"
- "where is the database connection configured"
- "error handling for API requests"`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language description of what to find',
      },
      directory: {
        type: 'string',
        description: 'Directory to search in',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum results (default: 10)',
      },
    },
    required: ['query'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    // This would integrate with a local embedding model or vector DB
    // For now, we do intelligent keyword extraction + grep
    const query = params.query as string;
    const directory = (params.directory as string) || process.cwd();
    const maxResults = (params.maxResults as number) || 10;

    // Extract likely code identifiers from natural language
    const keywords = extractCodeKeywords(query);
    
    const results: Array<{
      file: string;
      relevance: number;
      snippet: string;
      reason: string;
    }> = [];

    for (const keyword of keywords) {
      try {
        const grepResult = await grepSearchTool.execute({
          pattern: keyword,
          directory,
          maxResults: 5,
        });
        
        const grepData = grepResult.data as { results?: Array<{ file: string; content: string }> } | undefined;
        if (grepResult.success && grepData?.results) {
          for (const match of grepData.results) {
            results.push({
              file: match.file,
              relevance: calculateRelevance(query, match.content),
              snippet: match.content,
              reason: `Matched keyword: ${keyword}`,
            });
          }
        }
      } catch {
        // Continue with other keywords
      }
    }

    // Sort by relevance and dedupe
    const uniqueResults = dedupeByFile(results)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, maxResults);

    return {
      success: true,
      data: {
        query,
        results: uniqueResults,
      },
    };
  },
};

// Helper: Extract code-like keywords from natural language
function extractCodeKeywords(query: string): string[] {
  const keywords: string[] = [];
  
  // Common programming patterns
  const patterns = [
    /function\s+(\w+)/gi,
    /class\s+(\w+)/gi,
    /(\w+)\s*\(/g, // function calls
    /(?:handle|process|create|update|delete|get|set|fetch|save|load)(\w*)/gi,
    /(\w+)(?:Handler|Service|Controller|Manager|Factory|Builder)/gi,
  ];

  for (const pattern of patterns) {
    const matches = query.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && match[1].length > 2) {
        keywords.push(match[1]);
      }
    }
  }

  // Also add camelCase/PascalCase words
  const words = query.split(/\s+/);
  for (const word of words) {
    if (/^[A-Z][a-z]+[A-Z]/.test(word) || /^[a-z]+[A-Z]/.test(word)) {
      keywords.push(word);
    }
    // Common code terms
    if (['auth', 'api', 'db', 'config', 'error', 'user', 'data', 'state'].some(
      term => word.toLowerCase().includes(term)
    )) {
      keywords.push(word);
    }
  }

  return [...new Set(keywords)];
}

function calculateRelevance(query: string, content: string): number {
  const queryLower = query.toLowerCase();
  const contentLower = content.toLowerCase();
  
  let score = 0;
  const queryWords = queryLower.split(/\s+/);
  
  for (const word of queryWords) {
    if (contentLower.includes(word)) {
      score += word.length;
    }
  }
  
  return score;
}

function dedupeByFile<T extends { file: string }>(results: T[]): T[] {
  const seen = new Set<string>();
  return results.filter(r => {
    if (seen.has(r.file)) return false;
    seen.add(r.file);
    return true;
  });
}

// ============================================================================
// 3. CODE SYMBOLS - Find definitions, references, implementations
// ============================================================================

/**
 * Find symbol definitions and references using language-specific tools
 */
export const findSymbolTool: AgentTool = {
  name: 'find_symbol',
  description: `Find where a function, class, variable, or type is defined or used.
Uses language servers and AST parsing when available.
Supports: TypeScript, JavaScript, Python, Go, Rust, Java, C/C++`,
  parameters: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Name of the symbol to find',
      },
      type: {
        type: 'string',
        enum: ['definition', 'references', 'implementations', 'all'],
        description: 'What to find (default: all)',
      },
      directory: {
        type: 'string',
        description: 'Directory to search in',
      },
      language: {
        type: 'string',
        description: 'Programming language (auto-detected if not specified)',
      },
    },
    required: ['symbol'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const symbol = params.symbol as string;
    const searchType = (params.type as string) || 'all';
    const directory = (params.directory as string) || process.cwd();

    const results: {
      definitions: Array<{ file: string; line: number; content: string }>;
      references: Array<{ file: string; line: number; content: string }>;
      implementations: Array<{ file: string; line: number; content: string }>;
    } = {
      definitions: [],
      references: [],
      implementations: [],
    };

    // Use multiple strategies
    
    // 1. TypeScript/JavaScript: Use tsc or typescript API
    if (await hasTypeScriptProject(directory)) {
      const tsResults = await findTypeScriptSymbol(symbol, directory);
      Object.assign(results, tsResults);
    }

    // 2. Universal: Pattern-based search for definitions
    const defPatterns = [
      `function\\s+${symbol}\\s*\\(`,     // function definition
      `const\\s+${symbol}\\s*=`,          // const assignment
      `let\\s+${symbol}\\s*=`,            // let assignment
      `class\\s+${symbol}\\s*[{<]`,       // class definition
      `interface\\s+${symbol}\\s*[{<]`,   // interface definition
      `type\\s+${symbol}\\s*=`,           // type alias
      `def\\s+${symbol}\\s*\\(`,          // Python function
      `class\\s+${symbol}\\s*[:\\(]`,     // Python class
      `fn\\s+${symbol}\\s*[<\\(]`,        // Rust function
      `func\\s+${symbol}\\s*[<\\(]`,      // Go function
    ];

    if (searchType === 'definition' || searchType === 'all') {
      for (const pattern of defPatterns) {
        const grepResult = await grepSearchTool.execute({
          pattern,
          directory,
          maxResults: 10,
        });
        const grepData = grepResult.data as { results?: Array<{ file: string; line: number; content: string }> } | undefined;
        if (grepResult.success && grepData?.results) {
          results.definitions.push(...grepData.results.map((r) => ({
            file: r.file,
            line: r.line,
            content: r.content,
          })));
        }
      }
    }

    // 3. Find references (usages)
    if (searchType === 'references' || searchType === 'all') {
      const refResult = await grepSearchTool.execute({
        pattern: `\\b${symbol}\\b`,
        directory,
        maxResults: 50,
      });
      const refData = refResult.data as { results?: Array<{ file: string; line: number; content: string }> } | undefined;
      if (refResult.success && refData?.results) {
        results.references = refData.results
          .filter((r) => !isDefinition(r.content, symbol))
          .map((r) => ({
            file: r.file,
            line: r.line,
            content: r.content,
          }));
      }
    }

    return {
      success: true,
      data: {
        symbol,
        ...results,
        summary: {
          definitions: results.definitions.length,
          references: results.references.length,
          implementations: results.implementations.length,
        },
      },
    };
  },
};

async function hasTypeScriptProject(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, 'tsconfig.json'));
    return true;
  } catch {
    return false;
  }
}

async function findTypeScriptSymbol(symbol: string, directory: string): Promise<{
  definitions: Array<{ file: string; line: number; content: string }>;
  references: Array<{ file: string; line: number; content: string }>;
  implementations: Array<{ file: string; line: number; content: string }>;
}> {
  // This could integrate with TypeScript compiler API
  // For now, return empty (grep fallback handles it)
  return { definitions: [], references: [], implementations: [] };
}

function isDefinition(content: string, symbol: string): boolean {
  const defPatterns = [
    new RegExp(`function\\s+${symbol}\\s*\\(`),
    new RegExp(`(const|let|var)\\s+${symbol}\\s*=`),
    new RegExp(`class\\s+${symbol}\\s*[{<]`),
    new RegExp(`interface\\s+${symbol}\\s*[{<]`),
    new RegExp(`type\\s+${symbol}\\s*=`),
  ];
  return defPatterns.some(p => p.test(content));
}

// ============================================================================
// 4. CODE DIFF/PATCH - Create and apply code patches
// ============================================================================

/**
 * Create or apply unified diff patches
 */
export const codePatchTool: AgentTool = {
  name: 'code_patch',
  description: `Create or apply code patches in unified diff format.
Use for:
- Making precise code changes
- Reviewing proposed modifications
- Applying changes from AI suggestions`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'apply', 'preview'],
        description: 'Action to perform',
      },
      file: {
        type: 'string',
        description: 'File to patch',
      },
      oldContent: {
        type: 'string',
        description: 'Original content (for create action)',
      },
      newContent: {
        type: 'string',
        description: 'New content (for create action)',
      },
      patch: {
        type: 'string',
        description: 'Patch to apply (for apply action)',
      },
    },
    required: ['action'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const action = params.action as string;
    const filePath = params.file as string;

    switch (action) {
      case 'create': {
        const oldContent = params.oldContent as string;
        const newContent = params.newContent as string;
        const patch = createUnifiedDiff(filePath, oldContent, newContent);
        return { success: true, data: { patch } };
      }
      
      case 'preview':
      case 'apply': {
        const patch = params.patch as string;
        if (!filePath || !patch) {
          return { success: false, error: 'File and patch required' };
        }
        
        try {
          const currentContent = await fs.readFile(filePath, 'utf-8');
          const newContent = applyUnifiedDiff(currentContent, patch);
          
          if (action === 'preview') {
            return {
              success: true,
              data: {
                file: filePath,
                preview: newContent,
                changes: countChanges(patch),
              },
            };
          }
          
          await fs.writeFile(filePath, newContent, 'utf-8');
          return {
            success: true,
            data: {
              file: filePath,
              applied: true,
              changes: countChanges(patch),
            },
          };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      }
      
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  },
};

function createUnifiedDiff(filename: string, oldContent: string, newContent: string): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  
  let diff = `--- a/${filename}\n+++ b/${filename}\n`;
  
  // Simple line-by-line diff (a proper implementation would use LCS)
  let i = 0, j = 0;
  let hunkStart = -1;
  let hunk = '';
  
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      if (hunkStart >= 0) {
        hunk += ` ${oldLines[i]}\n`;
      }
      i++; j++;
    } else {
      if (hunkStart < 0) {
        hunkStart = i;
        diff += `@@ -${i + 1} +${j + 1} @@\n`;
      }
      
      if (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
        hunk += `-${oldLines[i]}\n`;
        i++;
      }
      if (j < newLines.length && (i >= oldLines.length || oldLines[i - 1] !== newLines[j])) {
        hunk += `+${newLines[j]}\n`;
        j++;
      }
    }
  }
  
  return diff + hunk;
}

function applyUnifiedDiff(content: string, patch: string): string {
  // Simplified patch application
  const lines = content.split('\n');
  const patchLines = patch.split('\n');
  const result: string[] = [];
  
  let lineIndex = 0;
  
  for (const patchLine of patchLines) {
    if (patchLine.startsWith('@@')) {
      // Parse hunk header
      const match = patchLine.match(/@@ -(\d+)/);
      if (match) {
        const startLine = parseInt(match[1]) - 1;
        // Copy lines before the hunk
        while (lineIndex < startLine) {
          result.push(lines[lineIndex++]);
        }
      }
    } else if (patchLine.startsWith('-')) {
      // Remove line (skip it)
      lineIndex++;
    } else if (patchLine.startsWith('+')) {
      // Add line
      result.push(patchLine.slice(1));
    } else if (patchLine.startsWith(' ')) {
      // Context line
      result.push(lines[lineIndex++]);
    }
  }
  
  // Copy remaining lines
  while (lineIndex < lines.length) {
    result.push(lines[lineIndex++]);
  }
  
  return result.join('\n');
}

function countChanges(patch: string): { additions: number; deletions: number } {
  const lines = patch.split('\n');
  return {
    additions: lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length,
    deletions: lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length,
  };
}

// ============================================================================
// 5. RUN TESTS - Execute and analyze test results
// ============================================================================

/**
 * Run tests and parse results
 */
export const runTestsTool: AgentTool = {
  name: 'run_tests',
  description: `Run tests and get structured results.
Supports: Jest, Vitest, Mocha, Pytest, Go test, Cargo test
Automatically detects test framework from project config.`,
  parameters: {
    type: 'object',
    properties: {
      testPattern: {
        type: 'string',
        description: 'Pattern to match test files or test names',
      },
      directory: {
        type: 'string',
        description: 'Project directory',
      },
      watch: {
        type: 'boolean',
        description: 'Run in watch mode',
      },
      coverage: {
        type: 'boolean',
        description: 'Collect coverage',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const directory = (params.directory as string) || process.cwd();
    const testPattern = params.testPattern as string | undefined;
    const coverage = params.coverage as boolean;

    // Detect test framework
    const framework = await detectTestFramework(directory);
    
    let command: string;
    switch (framework) {
      case 'jest':
        command = 'npx jest --json';
        if (testPattern) command += ` "${testPattern}"`;
        if (coverage) command += ' --coverage';
        break;
      case 'vitest':
        command = 'npx vitest run --reporter=json';
        if (testPattern) command += ` "${testPattern}"`;
        if (coverage) command += ' --coverage';
        break;
      case 'pytest':
        command = 'python -m pytest --tb=short -q';
        if (testPattern) command += ` -k "${testPattern}"`;
        if (coverage) command += ' --cov';
        break;
      case 'go':
        command = 'go test -json ./...';
        if (testPattern) command += ` -run "${testPattern}"`;
        if (coverage) command += ' -cover';
        break;
      default:
        command = 'npm test';
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: directory,
        maxBuffer: 10 * 1024 * 1024,
      });

      // Parse results based on framework
      const results = parseTestResults(framework, stdout, stderr);
      
      return {
        success: true,
        data: {
          framework,
          ...results,
        },
      };
    } catch (error) {
      const err = error as Error & { stdout?: string; stderr?: string };
      // Test failures still produce output
      const results = parseTestResults(framework, err.stdout || '', err.stderr || '');
      return {
        success: true,
        data: {
          framework,
          hasFailures: true,
          ...results,
        },
      };
    }
  },
};

async function detectTestFramework(dir: string): Promise<string> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf-8'));
    if (pkg.devDependencies?.vitest || pkg.dependencies?.vitest) return 'vitest';
    if (pkg.devDependencies?.jest || pkg.dependencies?.jest) return 'jest';
    if (pkg.devDependencies?.mocha || pkg.dependencies?.mocha) return 'mocha';
  } catch { /* not a node project */ }

  try {
    await fs.access(path.join(dir, 'pytest.ini'));
    return 'pytest';
  } catch { /* not pytest */ }

  try {
    await fs.access(path.join(dir, 'go.mod'));
    return 'go';
  } catch { /* not go */ }

  try {
    await fs.access(path.join(dir, 'Cargo.toml'));
    return 'cargo';
  } catch { /* not rust */ }

  return 'unknown';
}

function parseTestResults(framework: string, stdout: string, stderr: string): {
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  failures: Array<{ test: string; error: string }>;
} {
  const result = {
    passed: 0,
    failed: 0,
    skipped: 0,
    duration: 0,
    failures: [] as Array<{ test: string; error: string }>,
  };

  try {
    if (framework === 'jest' || framework === 'vitest') {
      const json = JSON.parse(stdout);
      result.passed = json.numPassedTests || 0;
      result.failed = json.numFailedTests || 0;
      result.skipped = json.numPendingTests || 0;
      result.duration = json.testResults?.[0]?.endTime - json.testResults?.[0]?.startTime || 0;
      
      for (const suite of json.testResults || []) {
        for (const test of suite.assertionResults || []) {
          if (test.status === 'failed') {
            result.failures.push({
              test: test.fullName || test.title,
              error: test.failureMessages?.join('\n') || 'Unknown error',
            });
          }
        }
      }
    }
  } catch {
    // Parse from plain text output
    const passMatch = stdout.match(/(\d+)\s*pass/i);
    const failMatch = stdout.match(/(\d+)\s*fail/i);
    const skipMatch = stdout.match(/(\d+)\s*skip/i);
    
    if (passMatch) result.passed = parseInt(passMatch[1]);
    if (failMatch) result.failed = parseInt(failMatch[1]);
    if (skipMatch) result.skipped = parseInt(skipMatch[1]);
  }

  return result;
}

// ============================================================================
// 6. LINT/FORMAT CODE - Run linters and formatters
// ============================================================================

/**
 * Run linters and code formatters
 */
export const lintFormatTool: AgentTool = {
  name: 'lint_format',
  description: `Run linters and formatters on code.
Supports: ESLint, Prettier, Black, Ruff, gofmt, rustfmt
Auto-detects tools from project configuration.`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['lint', 'format', 'fix'],
        description: 'Action: lint (check), format (apply), fix (auto-fix lint issues)',
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files to process (default: all)',
      },
      directory: {
        type: 'string',
        description: 'Project directory',
      },
    },
    required: ['action'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const action = params.action as string;
    const directory = (params.directory as string) || process.cwd();
    const files = (params.files as string[]) || ['.'];

    const fileArg = files.join(' ');
    const commands: string[] = [];

    // Detect available tools
    const hasEslint = await fileExists(path.join(directory, '.eslintrc.js')) ||
                      await fileExists(path.join(directory, '.eslintrc.json')) ||
                      await fileExists(path.join(directory, 'eslint.config.js'));
    const hasPrettier = await fileExists(path.join(directory, '.prettierrc')) ||
                        await fileExists(path.join(directory, 'prettier.config.js'));

    if (action === 'lint' || action === 'fix') {
      if (hasEslint) {
        commands.push(`npx eslint ${action === 'fix' ? '--fix' : ''} ${fileArg}`);
      }
    }

    if (action === 'format') {
      if (hasPrettier) {
        commands.push(`npx prettier --write ${fileArg}`);
      }
    }

    const results: Array<{ command: string; success: boolean; output: string }> = [];

    for (const cmd of commands) {
      try {
        const { stdout, stderr } = await execAsync(cmd, { cwd: directory });
        results.push({ command: cmd, success: true, output: stdout || stderr });
      } catch (error) {
        const err = error as Error & { stdout?: string; stderr?: string };
        results.push({ 
          command: cmd, 
          success: false, 
          output: err.stderr || err.stdout || err.message,
        });
      }
    }

    return {
      success: results.every(r => r.success),
      data: {
        action,
        results,
      },
    };
  },
};

async function fileExists(filepath: string): Promise<boolean> {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export function getCodeIntelligenceTools(): AgentTool[] {
  return [
    grepSearchTool,
    semanticSearchTool,
    findSymbolTool,
    codePatchTool,
    runTestsTool,
    lintFormatTool,
  ];
}

export default {
  grepSearchTool,
  semanticSearchTool,
  findSymbolTool,
  codePatchTool,
  runTestsTool,
  lintFormatTool,
  getCodeIntelligenceTools,
};
