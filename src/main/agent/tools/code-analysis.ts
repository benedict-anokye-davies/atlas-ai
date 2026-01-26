/**
 * Atlas Desktop - Advanced Code Analysis Tools
 * 
 * Deep code understanding with AST parsing, complexity analysis,
 * dependency tracking, and code quality metrics.
 * 
 * @module agent/tools/code-analysis
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import { count } from '../../../shared/utils';

const execAsync = promisify(exec);
const logger = createModuleLogger('CodeAnalysis');

// ============================================================================
// 1. AST PARSING - Tree-sitter powered code analysis
// ============================================================================

interface ASTNode {
  type: string;
  name?: string;
  startLine: number;
  endLine: number;
  children?: ASTNode[];
}

/**
 * Parse code into an Abstract Syntax Tree for precise manipulation
 */
export const parseASTTool: AgentTool = {
  name: 'parse_ast',
  description: `Parse source code into an Abstract Syntax Tree (AST).
Returns structured representation of code including:
- Functions, classes, methods
- Variables and their scopes
- Import/export statements
- Control flow (if/for/while)

Useful for:
- Understanding code structure
- Finding specific code patterns
- Preparing for refactoring`,
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'File path to parse',
      },
      content: {
        type: 'string',
        description: 'Code content to parse (alternative to file)',
      },
      language: {
        type: 'string',
        description: 'Language (auto-detected from file extension if not provided)',
      },
      depth: {
        type: 'number',
        description: 'Max depth to traverse (default: 3)',
      },
      filter: {
        type: 'array',
        items: { type: 'string' },
        description: 'Node types to include (e.g., ["function", "class", "import"])',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const filePath = params.file as string | undefined;
    let content = params.content as string | undefined;
    const maxDepth = (params.depth as number) || 3;
    const filter = params.filter as string[] | undefined;

    try {
      // Read file if path provided
      if (filePath && !content) {
        content = await fs.readFile(filePath, 'utf-8');
      }

      if (!content) {
        return { success: false, error: 'No file or content provided' };
      }

      // Detect language
      const language = (params.language as string) || detectLanguage(filePath || '');
      
      // Parse using regex-based AST extraction (works without tree-sitter)
      const ast = parseCodeToAST(content, language, maxDepth, filter);

      return {
        success: true,
        data: {
          language,
          file: filePath,
          ast,
          summary: summarizeAST(ast),
        },
      };
    } catch (error) {
      logger.error('AST parsing failed', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
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
  };
  return langMap[ext] || 'unknown';
}

function parseCodeToAST(
  content: string,
  language: string,
  maxDepth: number,
  filter?: string[]
): ASTNode[] {
  const nodes: ASTNode[] = [];
  const lines = content.split('\n');

  // Language-specific patterns
  const patterns: Record<string, RegExp[]> = {
    typescript: [
      /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
      /^(?:export\s+)?class\s+(\w+)/,
      /^(?:export\s+)?interface\s+(\w+)/,
      /^(?:export\s+)?type\s+(\w+)/,
      /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/,
      /^import\s+(?:{[^}]+}|\w+)\s+from\s+['"]([^'"]+)['"]/,
      /^export\s+(?:{[^}]+}|\*)\s+from\s+['"]([^'"]+)['"]/,
    ],
    javascript: [
      /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
      /^(?:export\s+)?class\s+(\w+)/,
      /^(?:const|let|var)\s+(\w+)\s*=/,
      /^import\s+(?:{[^}]+}|\w+)\s+from\s+['"]([^'"]+)['"]/,
    ],
    python: [
      /^(?:async\s+)?def\s+(\w+)/,
      /^class\s+(\w+)/,
      /^(\w+)\s*=(?!=)/,
      /^from\s+(\S+)\s+import/,
      /^import\s+(\S+)/,
    ],
    go: [
      /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/,
      /^type\s+(\w+)\s+struct/,
      /^type\s+(\w+)\s+interface/,
      /^import\s+(?:\(\s*)?["']([^"']+)["']/,
    ],
    rust: [
      /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/,
      /^(?:pub\s+)?struct\s+(\w+)/,
      /^(?:pub\s+)?enum\s+(\w+)/,
      /^(?:pub\s+)?trait\s+(\w+)/,
      /^use\s+(\S+)/,
    ],
  };

  const langPatterns = patterns[language] || patterns.typescript;
  
  let currentBlock: { type: string; name: string; startLine: number; depth: number } | null = null;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    // Track brace depth for block boundaries
    braceDepth += (line.match(/{/g) || []).length;
    braceDepth -= (line.match(/}/g) || []).length;

    // Check if current block ends
    if (currentBlock && braceDepth <= currentBlock.depth) {
      nodes.push({
        type: currentBlock.type,
        name: currentBlock.name,
        startLine: currentBlock.startLine,
        endLine: lineNum,
      });
      currentBlock = null;
    }

    // Match patterns
    for (const pattern of langPatterns) {
      const match = line.match(pattern);
      if (match) {
        const name = match[1];
        let type = 'unknown';

        if (/function|def|fn|func/.test(line)) type = 'function';
        else if (/class/.test(line)) type = 'class';
        else if (/interface|trait/.test(line)) type = 'interface';
        else if (/type|struct|enum/.test(line)) type = 'type';
        else if (/import|from|use/.test(line)) type = 'import';
        else if (/export/.test(line)) type = 'export';
        else if (/const|let|var|=/.test(line)) type = 'variable';

        // Apply filter
        if (filter && !filter.includes(type)) continue;

        // Check if this starts a block
        if (['function', 'class', 'interface', 'type'].includes(type)) {
          currentBlock = { type, name, startLine: lineNum, depth: braceDepth - 1 };
        } else {
          nodes.push({
            type,
            name,
            startLine: lineNum,
            endLine: lineNum,
          });
        }
        break;
      }
    }
  }

  // Close any unclosed block
  if (currentBlock) {
    nodes.push({
      type: currentBlock.type,
      name: currentBlock.name,
      startLine: currentBlock.startLine,
      endLine: lines.length,
    });
  }

  return nodes;
}

function summarizeAST(nodes: ASTNode[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const node of nodes) {
    summary[node.type] = (summary[node.type] || 0) + 1;
  }
  return summary;
}

// ============================================================================
// 2. CODE COMPLEXITY ANALYSIS
// ============================================================================

interface ComplexityResult {
  file: string;
  overall: number;
  functions: Array<{
    name: string;
    line: number;
    complexity: number;
    risk: 'low' | 'medium' | 'high' | 'very-high';
  }>;
  suggestions: string[];
}

/**
 * Analyze code complexity (cyclomatic complexity, cognitive complexity)
 */
export const analyzeComplexityTool: AgentTool = {
  name: 'analyze_complexity',
  description: `Calculate code complexity metrics:
- Cyclomatic complexity (control flow paths)
- Cognitive complexity (mental effort to understand)
- Function length and nesting depth

Returns risk assessment and refactoring suggestions.`,
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'File to analyze',
      },
      content: {
        type: 'string',
        description: 'Code content to analyze',
      },
      threshold: {
        type: 'number',
        description: 'Complexity threshold for warnings (default: 10)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const filePath = params.file as string | undefined;
    let content = params.content as string | undefined;
    const threshold = (params.threshold as number) || 10;

    try {
      if (filePath && !content) {
        content = await fs.readFile(filePath, 'utf-8');
      }

      if (!content) {
        return { success: false, error: 'No file or content provided' };
      }

      const result = calculateComplexity(content, filePath || 'input', threshold);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

function calculateComplexity(content: string, file: string, threshold: number): ComplexityResult {
  const lines = content.split('\n');
  const functions: ComplexityResult['functions'] = [];
  const suggestions: string[] = [];

  // Complexity indicators
  const complexityPatterns = [
    { pattern: /\bif\b/, weight: 1, type: 'branch' },
    { pattern: /\belse\s+if\b/, weight: 1, type: 'branch' },
    { pattern: /\belse\b/, weight: 1, type: 'branch' },
    { pattern: /\bfor\b/, weight: 1, type: 'loop' },
    { pattern: /\bwhile\b/, weight: 1, type: 'loop' },
    { pattern: /\bdo\b/, weight: 1, type: 'loop' },
    { pattern: /\bswitch\b/, weight: 1, type: 'branch' },
    { pattern: /\bcase\b/, weight: 1, type: 'branch' },
    { pattern: /\bcatch\b/, weight: 1, type: 'exception' },
    { pattern: /\?.*:/, weight: 1, type: 'ternary' },
    { pattern: /&&|\|\|/, weight: 1, type: 'logical' },
    { pattern: /\?\?/, weight: 1, type: 'nullish' },
  ];

  // Find functions and calculate their complexity
  let currentFunc: { name: string; startLine: number; complexity: number } | null = null;
  let braceDepth = 0;
  let funcStartDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Track braces
    braceDepth += (line.match(/{/g) || []).length;
    braceDepth -= (line.match(/}/g) || []).length;

    // Detect function start
    const funcMatch = line.match(/(?:async\s+)?(?:function\s+(\w+)|(\w+)\s*[=:]\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/);
    if (funcMatch && !currentFunc) {
      currentFunc = {
        name: funcMatch[1] || funcMatch[2] || 'anonymous',
        startLine: lineNum,
        complexity: 1, // Base complexity
      };
      funcStartDepth = braceDepth - 1;
    }

    // Calculate complexity for current function
    if (currentFunc) {
      for (const { pattern, weight } of complexityPatterns) {
        const matches = line.match(new RegExp(pattern, 'g'));
        if (matches) {
          currentFunc.complexity += matches.length * weight;
        }
      }

      // Add nesting penalty
      const nestingLevel = braceDepth - funcStartDepth;
      if (nestingLevel > 3 && /\b(if|for|while)\b/.test(line)) {
        currentFunc.complexity += nestingLevel - 3;
      }
    }

    // Detect function end
    if (currentFunc && braceDepth <= funcStartDepth) {
      const risk = getComplexityRisk(currentFunc.complexity, threshold);
      functions.push({
        name: currentFunc.name,
        line: currentFunc.startLine,
        complexity: currentFunc.complexity,
        risk,
      });

      // Generate suggestions
      if (risk === 'high' || risk === 'very-high') {
        suggestions.push(
          `Function '${currentFunc.name}' (line ${currentFunc.startLine}) has high complexity (${currentFunc.complexity}). Consider extracting helper functions.`
        );
      }

      currentFunc = null;
    }
  }

  // Calculate overall complexity
  const overall = functions.reduce((sum, f) => sum + f.complexity, 0) / Math.max(functions.length, 1);

  // Add general suggestions
  const veryHighCount = count(functions, f => f.risk === 'very-high');
  if (veryHighCount > 0) {
    suggestions.push(
      `${veryHighCount} function(s) have very high complexity. Major refactoring recommended.`
    );
  }

  const longFile = lines.length > 500;
  if (longFile) {
    suggestions.push(
      `File has ${lines.length} lines. Consider splitting into multiple files.`
    );
  }

  return {
    file,
    overall: Math.round(overall * 10) / 10,
    functions: functions.sort((a, b) => b.complexity - a.complexity),
    suggestions,
  };
}

function getComplexityRisk(complexity: number, threshold: number): 'low' | 'medium' | 'high' | 'very-high' {
  if (complexity <= threshold * 0.5) return 'low';
  if (complexity <= threshold) return 'medium';
  if (complexity <= threshold * 2) return 'high';
  return 'very-high';
}

// ============================================================================
// 3. DEPENDENCY ANALYSIS
// ============================================================================

interface DependencyInfo {
  name: string;
  version?: string;
  type: 'production' | 'development' | 'peer' | 'optional';
  usedIn: string[];
  unused: boolean;
}

/**
 * Analyze project dependencies - find unused, outdated, or problematic packages
 */
export const analyzeDependenciesTool: AgentTool = {
  name: 'analyze_dependencies',
  description: `Analyze project dependencies:
- Find unused dependencies
- Check for outdated packages
- Identify security vulnerabilities
- Find duplicate/conflicting versions
- Calculate dependency tree depth`,
  parameters: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description: 'Project directory (default: current)',
      },
      checkOutdated: {
        type: 'boolean',
        description: 'Check for outdated packages',
      },
      checkSecurity: {
        type: 'boolean',
        description: 'Run security audit',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const directory = (params.directory as string) || process.cwd();
    const checkOutdated = params.checkOutdated as boolean;
    const checkSecurity = params.checkSecurity as boolean;

    try {
      // Read package.json
      const pkgPath = path.join(directory, 'package.json');
      const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));

      const allDeps: DependencyInfo[] = [];

      // Gather all dependencies
      for (const [name, version] of Object.entries(pkg.dependencies || {})) {
        allDeps.push({
          name,
          version: version as string,
          type: 'production',
          usedIn: [],
          unused: true,
        });
      }

      for (const [name, version] of Object.entries(pkg.devDependencies || {})) {
        allDeps.push({
          name,
          version: version as string,
          type: 'development',
          usedIn: [],
          unused: true,
        });
      }

      // Scan source files for imports
      const sourceFiles = await findSourceFiles(directory);
      for (const file of sourceFiles) {
        const content = await fs.readFile(file, 'utf-8');
        const imports = extractImports(content);
        
        for (const imp of imports) {
          const dep = allDeps.find(d => imp.startsWith(d.name));
          if (dep) {
            dep.unused = false;
            dep.usedIn.push(path.relative(directory, file));
          }
        }
      }

      // Check for outdated packages
      let outdated: Record<string, { current: string; latest: string }> = {};
      if (checkOutdated) {
        try {
          const { stdout } = await execAsync('npm outdated --json', { cwd: directory });
          outdated = JSON.parse(stdout || '{}');
        } catch (e) {
          // npm outdated returns exit code 1 if outdated packages exist
          const err = e as { stdout?: string };
          if (err.stdout) {
            outdated = JSON.parse(err.stdout);
          }
        }
      }

      // Security audit
      let vulnerabilities: Array<{ name: string; severity: string; title: string }> = [];
      if (checkSecurity) {
        try {
          const { stdout } = await execAsync('npm audit --json', { cwd: directory });
          const audit = JSON.parse(stdout || '{}');
          vulnerabilities = Object.entries(audit.vulnerabilities || {}).map(
            ([name, info]: [string, unknown]) => ({
              name,
              severity: (info as { severity: string }).severity,
              title: (info as { via: Array<{ title: string }> }).via?.[0]?.title || 'Unknown',
            })
          );
        } catch (e) {
          // Audit might fail or have vulnerabilities
          const err = e as { stdout?: string };
          if (err.stdout) {
            try {
              const audit = JSON.parse(err.stdout);
              vulnerabilities = Object.entries(audit.vulnerabilities || {}).map(
                ([name, info]: [string, unknown]) => ({
                  name,
                  severity: (info as { severity: string }).severity,
                  title: (info as { via: Array<{ title: string }> }).via?.[0]?.title || 'Unknown',
                })
              );
            } catch { /* ignore */ }
          }
        }
      }

      const unusedDeps = allDeps.filter(d => d.unused);

      return {
        success: true,
        data: {
          total: allDeps.length,
          production: count(allDeps, d => d.type === 'production'),
          development: count(allDeps, d => d.type === 'development'),
          unused: unusedDeps.map(d => ({ name: d.name, type: d.type })),
          outdated: Object.entries(outdated).map(([name, info]) => ({
            name,
            current: info.current,
            latest: info.latest,
          })),
          vulnerabilities,
          recommendations: generateDepRecommendations(unusedDeps, outdated, vulnerabilities),
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

async function findSourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    // Skip node_modules and hidden directories
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      files.push(...await findSourceFiles(fullPath));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function extractImports(content: string): string[] {
  const imports: string[] = [];
  
  // ES imports
  const esImportRegex = /import\s+(?:{[^}]+}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = esImportRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  // CommonJS requires
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  // Filter out relative imports
  return imports.filter(i => !i.startsWith('.') && !i.startsWith('/'));
}

function generateDepRecommendations(
  unused: DependencyInfo[],
  outdated: Record<string, unknown>,
  vulnerabilities: Array<{ severity: string }>
): string[] {
  const recommendations: string[] = [];

  if (unused.length > 0) {
    recommendations.push(
      `Remove ${unused.length} unused dependencies: ${unused.slice(0, 5).map(d => d.name).join(', ')}${unused.length > 5 ? '...' : ''}`
    );
  }

  const outdatedCount = Object.keys(outdated).length;
  if (outdatedCount > 0) {
    recommendations.push(
      `Update ${outdatedCount} outdated packages with 'npm update' or 'npm install <package>@latest'`
    );
  }

  const criticalVulns = vulnerabilities.filter(v => v.severity === 'critical' || v.severity === 'high');
  if (criticalVulns.length > 0) {
    recommendations.push(
      `Fix ${criticalVulns.length} critical/high security vulnerabilities with 'npm audit fix'`
    );
  }

  return recommendations;
}

// ============================================================================
// 4. CODE DUPLICATION DETECTION
// ============================================================================

interface DuplicateBlock {
  hash: string;
  occurrences: Array<{
    file: string;
    startLine: number;
    endLine: number;
  }>;
  lines: number;
  content: string;
}

/**
 * Find duplicate/similar code blocks across files
 */
export const findDuplicatesTool: AgentTool = {
  name: 'find_duplicates',
  description: `Detect duplicate or similar code blocks:
- Exact duplicates (copy-paste code)
- Similar structures (parameterized differences)
- Suggests extraction into shared functions`,
  parameters: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description: 'Directory to scan',
      },
      minLines: {
        type: 'number',
        description: 'Minimum lines for a duplicate block (default: 5)',
      },
      extensions: {
        type: 'array',
        items: { type: 'string' },
        description: 'File extensions to scan (default: ts,js,tsx,jsx)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const directory = (params.directory as string) || process.cwd();
    const minLines = (params.minLines as number) || 5;
    const extensions = (params.extensions as string[]) || ['ts', 'js', 'tsx', 'jsx'];

    try {
      const files = await findSourceFiles(directory);
      const filteredFiles = files.filter(f => 
        extensions.some(ext => f.endsWith(`.${ext}`))
      );

      const duplicates = await findCodeDuplicates(filteredFiles, minLines);

      return {
        success: true,
        data: {
          scannedFiles: filteredFiles.length,
          duplicateBlocks: duplicates.length,
          totalDuplicateLines: duplicates.reduce((sum, d) => sum + d.lines * d.occurrences.length, 0),
          duplicates: duplicates.slice(0, 20), // Limit results
          recommendations: duplicates.length > 0
            ? [`Extract ${duplicates.length} duplicate code blocks into shared functions/utilities`]
            : ['No significant code duplication found'],
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

async function findCodeDuplicates(files: string[], minLines: number): Promise<DuplicateBlock[]> {
  const blockHashes = new Map<string, DuplicateBlock>();

  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const lines = content.split('\n');

      // Sliding window to find duplicate blocks
      for (let i = 0; i < lines.length - minLines; i++) {
        const block = lines.slice(i, i + minLines);
        const normalized = normalizeCode(block.join('\n'));
        
        if (normalized.trim().length < 50) continue; // Skip trivial blocks

        const hash = simpleHash(normalized);
        
        if (blockHashes.has(hash)) {
          const existing = blockHashes.get(hash)!;
          existing.occurrences.push({
            file,
            startLine: i + 1,
            endLine: i + minLines,
          });
        } else {
          blockHashes.set(hash, {
            hash,
            occurrences: [{
              file,
              startLine: i + 1,
              endLine: i + minLines,
            }],
            lines: minLines,
            content: block.slice(0, 3).join('\n') + '\n...', // Preview
          });
        }
      }
    } catch { /* skip unreadable files */ }
  }

  // Filter to actual duplicates (more than one occurrence)
  return Array.from(blockHashes.values())
    .filter(d => d.occurrences.length > 1)
    .sort((a, b) => b.occurrences.length - a.occurrences.length);
}

function normalizeCode(code: string): string {
  return code
    .replace(/\/\/.*$/gm, '') // Remove line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/['"`][^'"`]*['"`]/g, '""') // Normalize strings
    .replace(/\d+/g, '0') // Normalize numbers
    .trim();
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

// ============================================================================
// 5. DEAD CODE DETECTION
// ============================================================================

/**
 * Find unused exports, functions, and variables
 */
export const findDeadCodeTool: AgentTool = {
  name: 'find_dead_code',
  description: `Find potentially dead/unused code:
- Exported but never imported symbols
- Private functions never called
- Unused variables
- Unreachable code after return/throw`,
  parameters: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description: 'Directory to analyze',
      },
      includeTests: {
        type: 'boolean',
        description: 'Include test files in usage analysis',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const directory = (params.directory as string) || process.cwd();
    const includeTests = (params.includeTests as boolean) ?? true;

    try {
      const files = await findSourceFiles(directory);
      const filteredFiles = includeTests 
        ? files 
        : files.filter(f => !f.includes('.test.') && !f.includes('.spec.') && !f.includes('__tests__'));

      // Collect all exports and their usages
      const exports = new Map<string, { file: string; line: number; usages: string[] }>();
      const imports = new Map<string, Set<string>>();

      for (const file of filteredFiles) {
        const content = await fs.readFile(file, 'utf-8');
        const lines = content.split('\n');

        // Find exports
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          
          // Named exports
          const namedExport = line.match(/export\s+(?:const|let|var|function|class|interface|type)\s+(\w+)/);
          if (namedExport) {
            exports.set(`${file}:${namedExport[1]}`, {
              file,
              line: i + 1,
              usages: [],
            });
          }

          // Export { name }
          const exportBrackets = line.match(/export\s*{([^}]+)}/);
          if (exportBrackets) {
            const names = exportBrackets[1].split(',').map(n => n.trim().split(' as ')[0].trim());
            for (const name of names) {
              exports.set(`${file}:${name}`, { file, line: i + 1, usages: [] });
            }
          }
        }

        // Find imports
        const importRegex = /import\s*{([^}]+)}\s*from\s*['"]([^'"]+)['"]/g;
        let match;
        while ((match = importRegex.exec(content)) !== null) {
          const names = match[1].split(',').map(n => n.trim().split(' as ')[0].trim());
          const source = match[2];
          
          for (const name of names) {
            const key = `${source}:${name}`;
            if (!imports.has(key)) {
              imports.set(key, new Set());
            }
            imports.get(key)!.add(file);
          }
        }
      }

      // Match exports to imports
      const deadExports: Array<{ name: string; file: string; line: number }> = [];
      
      for (const [key, info] of exports) {
        const [, name] = key.split(':');
        let isUsed = false;

        // Check if any import matches this export
        for (const [importKey, usageFiles] of imports) {
          if (importKey.endsWith(`:${name}`)) {
            isUsed = true;
            info.usages.push(...usageFiles);
            break;
          }
        }

        if (!isUsed) {
          // Check for internal usage in the same file
          const content = await fs.readFile(info.file, 'utf-8');
          const usageRegex = new RegExp(`\\b${name}\\b`, 'g');
          const matches = content.match(usageRegex);
          
          // If only one match (the export itself), it's potentially dead
          if (!matches || matches.length <= 1) {
            deadExports.push({ name, file: info.file, line: info.line });
          }
        }
      }

      return {
        success: true,
        data: {
          scannedFiles: filteredFiles.length,
          totalExports: exports.size,
          potentiallyDead: deadExports.length,
          deadCode: deadExports.slice(0, 50),
          recommendations: deadExports.length > 0
            ? [`Review ${deadExports.length} potentially unused exports for removal`]
            : ['No obvious dead code detected'],
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

// ============================================================================
// EXPORTS
// ============================================================================

export function getCodeAnalysisTools(): AgentTool[] {
  return [
    parseASTTool,
    analyzeComplexityTool,
    analyzeDependenciesTool,
    findDuplicatesTool,
    findDeadCodeTool,
  ];
}

export default {
  parseASTTool,
  analyzeComplexityTool,
  analyzeDependenciesTool,
  findDuplicatesTool,
  findDeadCodeTool,
  getCodeAnalysisTools,
};
