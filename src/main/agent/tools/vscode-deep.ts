/**
 * VS Code Deep Integration Tool
 * 
 * Provides deep VS Code integration including LSP operations,
 * symbol navigation, code intelligence, and editor manipulation.
 * Uses VS Code's extensibility APIs for rich IDE features.
 * 
 * @module agent/tools/vscode-deep
 */

import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { createModuleLogger } from '../../utils/logger';

const execAsync = promisify(exec);
const logger = createModuleLogger('VSCodeDeep');

// ============================================================================
// Types
// ============================================================================

export interface VSCodeLocation {
  file: string;
  line: number;
  column: number;
}

export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  location: VSCodeLocation;
  containerName?: string;
  detail?: string;
  children?: SymbolInfo[];
}

export enum SymbolKind {
  File = 'file',
  Module = 'module',
  Namespace = 'namespace',
  Package = 'package',
  Class = 'class',
  Method = 'method',
  Property = 'property',
  Field = 'field',
  Constructor = 'constructor',
  Enum = 'enum',
  Interface = 'interface',
  Function = 'function',
  Variable = 'variable',
  Constant = 'constant',
  String = 'string',
  Number = 'number',
  Boolean = 'boolean',
  Array = 'array',
  Object = 'object',
  Key = 'key',
  Null = 'null',
  EnumMember = 'enumMember',
  Struct = 'struct',
  Event = 'event',
  Operator = 'operator',
  TypeParameter = 'typeParameter',
}

export interface Reference {
  location: VSCodeLocation;
  context: string;
  isDefinition: boolean;
  isDeclaration: boolean;
}

export interface DiagnosticInfo {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  source?: string;
  code?: string | number;
}

export interface CompletionItem {
  label: string;
  kind: string;
  detail?: string;
  documentation?: string;
  insertText?: string;
  sortText?: string;
}

export interface HoverInfo {
  contents: string[];
  range?: { start: VSCodeLocation; end: VSCodeLocation };
}

export interface CodeAction {
  title: string;
  kind: string;
  isPreferred?: boolean;
  edit?: WorkspaceEdit;
  command?: { command: string; arguments?: unknown[] };
}

export interface WorkspaceEdit {
  changes: Map<string, TextEdit[]>;
}

export interface TextEdit {
  range: { start: VSCodeLocation; end: VSCodeLocation };
  newText: string;
}

// ============================================================================
// VS Code CLI Helpers
// ============================================================================

/**
 * Execute a VS Code CLI command
 */
async function executeVSCodeCommand(command: string, args: string[] = []): Promise<string> {
  const codePath = getVSCodePath();
  const fullCommand = `"${codePath}" ${command} ${args.join(' ')}`;
  
  try {
    const { stdout, stderr } = await execAsync(fullCommand);
    if (stderr && !stderr.includes('warning')) {
      logger.warn('VS Code stderr:', stderr);
    }
    return stdout.trim();
  } catch (error) {
    logger.error('VS Code command failed:', error);
    throw error;
  }
}

/**
 * Get the VS Code executable path
 */
function getVSCodePath(): string {
  // Check common paths
  const paths = process.platform === 'win32' 
    ? [
        'code',
        'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd',
        'C:\\Program Files (x86)\\Microsoft VS Code\\bin\\code.cmd',
        `${process.env.LOCALAPPDATA}\\Programs\\Microsoft VS Code\\bin\\code.cmd`,
      ]
    : process.platform === 'darwin'
    ? [
        '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
        '/usr/local/bin/code',
      ]
    : [
        '/usr/bin/code',
        '/snap/bin/code',
      ];
  
  for (const p of paths) {
    if (p === 'code') return p; // Default to PATH
    if (fs.existsSync(p)) return p;
  }
  
  return 'code'; // Fallback to PATH
}

// ============================================================================
// Symbol Operations
// ============================================================================

/**
 * Find symbols in a workspace or file
 */
export async function findSymbols(
  query: string,
  options?: {
    file?: string;
    kind?: SymbolKind;
    limit?: number;
  }
): Promise<SymbolInfo[]> {
  const { file, kind, limit = 50 } = options || {};
  
  // Use ripgrep for fast symbol search with patterns
  const patterns = getSymbolPatterns(kind);
  const searchPath = file || '.';
  
  try {
    const results: SymbolInfo[] = [];
    
    for (const pattern of patterns) {
      const rgCommand = `rg --json -n "${pattern.replace(/"/g, '\\"')}" ${searchPath}`;
      
      try {
        const { stdout } = await execAsync(rgCommand, { maxBuffer: 10 * 1024 * 1024 });
        const lines = stdout.split('\n').filter(l => l.trim());
        
        for (const line of lines) {
          try {
            const match = JSON.parse(line);
            if (match.type === 'match') {
              const symbolInfo = parseSymbolFromMatch(match, query);
              if (symbolInfo && symbolInfo.name.toLowerCase().includes(query.toLowerCase())) {
                results.push(symbolInfo);
                if (results.length >= limit) break;
              }
            }
          } catch {
            // Skip invalid JSON
          }
        }
      } catch {
        // ripgrep returns non-zero if no matches
      }
      
      if (results.length >= limit) break;
    }
    
    return results;
  } catch (error) {
    logger.error('Symbol search failed:', error);
    return [];
  }
}

/**
 * Get symbol patterns for different kinds
 */
function getSymbolPatterns(kind?: SymbolKind): string[] {
  const allPatterns = [
    // Functions/Methods
    '(async\\s+)?function\\s+\\w+',
    '(public|private|protected)?\\s*(static)?\\s*\\w+\\s*\\([^)]*\\)\\s*[:{]',
    '\\w+\\s*=\\s*(async\\s*)?\\([^)]*\\)\\s*=>',
    
    // Classes/Interfaces
    '(export\\s+)?(class|interface|type|enum)\\s+\\w+',
    
    // Variables/Constants
    '(const|let|var)\\s+\\w+\\s*[=:]',
    '(export\\s+)?(const|let)\\s+\\w+',
  ];
  
  if (!kind) return allPatterns;
  
  switch (kind) {
    case SymbolKind.Function:
    case SymbolKind.Method:
      return allPatterns.slice(0, 3);
    case SymbolKind.Class:
    case SymbolKind.Interface:
      return [allPatterns[3]];
    case SymbolKind.Variable:
    case SymbolKind.Constant:
      return allPatterns.slice(4);
    default:
      return allPatterns;
  }
}

/**
 * Parse symbol info from ripgrep match
 */
function parseSymbolFromMatch(match: {
  data: {
    path: { text: string };
    line_number: number;
    lines: { text: string };
    submatches: Array<{ match: { text: string }; start: number }>;
  };
}, query: string): SymbolInfo | null {
  const { path: pathData, line_number, lines, submatches } = match.data;
  const lineText = lines.text;
  
  // Extract symbol name from the matched text
  const symbolMatch = lineText.match(
    /(?:function|class|interface|type|enum|const|let|var)\s+(\w+)|(\w+)\s*[=:]\s*(?:async\s*)?\(|(\w+)\s*\(/
  );
  
  if (!symbolMatch) return null;
  
  const name = symbolMatch[1] || symbolMatch[2] || symbolMatch[3];
  if (!name) return null;
  
  // Determine symbol kind
  let kind = SymbolKind.Variable;
  if (lineText.includes('function') || lineText.includes('=>')) {
    kind = SymbolKind.Function;
  } else if (lineText.includes('class')) {
    kind = SymbolKind.Class;
  } else if (lineText.includes('interface')) {
    kind = SymbolKind.Interface;
  } else if (lineText.includes('type')) {
    kind = SymbolKind.TypeParameter;
  } else if (lineText.includes('enum')) {
    kind = SymbolKind.Enum;
  } else if (lineText.includes('const')) {
    kind = SymbolKind.Constant;
  }
  
  return {
    name,
    kind,
    location: {
      file: pathData.text,
      line: line_number,
      column: submatches[0]?.start || 0,
    },
    detail: lineText.trim().substring(0, 100),
  };
}

// ============================================================================
// Reference Operations
// ============================================================================

/**
 * Find all references to a symbol
 */
export async function findReferences(
  symbolName: string,
  options?: {
    file?: string;
    includeDeclaration?: boolean;
    limit?: number;
  }
): Promise<Reference[]> {
  const { file, includeDeclaration = true, limit = 100 } = options || {};
  
  try {
    const searchPath = file ? path.dirname(file) : '.';
    const pattern = `\\b${symbolName}\\b`;
    
    const { stdout } = await execAsync(
      `rg --json -n "${pattern}" ${searchPath}`,
      { maxBuffer: 10 * 1024 * 1024 }
    );
    
    const references: Reference[] = [];
    const lines = stdout.split('\n').filter(l => l.trim());
    
    for (const line of lines) {
      try {
        const match = JSON.parse(line);
        if (match.type === 'match') {
          const { path: pathData, line_number, lines: lineData, submatches } = match.data;
          const lineText = lineData.text.trim();
          
          // Determine if this is a definition/declaration
          const isDefinition = isSymbolDefinition(lineText, symbolName);
          const isDeclaration = isSymbolDeclaration(lineText, symbolName);
          
          if (!includeDeclaration && (isDefinition || isDeclaration)) {
            continue;
          }
          
          references.push({
            location: {
              file: pathData.text,
              line: line_number,
              column: submatches[0]?.start || 0,
            },
            context: lineText.substring(0, 150),
            isDefinition,
            isDeclaration,
          });
          
          if (references.length >= limit) break;
        }
      } catch {
        // Skip invalid JSON
      }
    }
    
    return references;
  } catch {
    // ripgrep returns non-zero if no matches
    return [];
  }
}

/**
 * Check if a line is a symbol definition
 */
function isSymbolDefinition(line: string, symbolName: string): boolean {
  const definitionPatterns = [
    new RegExp(`function\\s+${symbolName}\\s*\\(`),
    new RegExp(`(class|interface|type|enum)\\s+${symbolName}\\b`),
    new RegExp(`(const|let|var)\\s+${symbolName}\\s*=`),
    new RegExp(`${symbolName}\\s*:\\s*function`),
    new RegExp(`${symbolName}\\s*=\\s*(async\\s*)?\\(`),
  ];
  
  return definitionPatterns.some(p => p.test(line));
}

/**
 * Check if a line is a symbol declaration
 */
function isSymbolDeclaration(line: string, symbolName: string): boolean {
  const declarationPatterns = [
    new RegExp(`(export\\s+)?(declare\\s+)?function\\s+${symbolName}`),
    new RegExp(`(export\\s+)?(declare\\s+)?(class|interface|type)\\s+${symbolName}`),
    new RegExp(`\\b${symbolName}\\s*:\\s*[A-Z]\\w+`), // Type annotation
  ];
  
  return declarationPatterns.some(p => p.test(line));
}

// ============================================================================
// Go To Definition
// ============================================================================

/**
 * Find the definition of a symbol
 */
export async function goToDefinition(
  symbolName: string,
  fromFile?: string
): Promise<VSCodeLocation | null> {
  const references = await findReferences(symbolName, {
    file: fromFile,
    includeDeclaration: true,
    limit: 50,
  });
  
  // Find the definition
  const definition = references.find(r => r.isDefinition || r.isDeclaration);
  
  if (definition) {
    return definition.location;
  }
  
  // Fallback: return first reference
  return references.length > 0 ? references[0].location : null;
}

// ============================================================================
// Diagnostics
// ============================================================================

/**
 * Get diagnostics (errors/warnings) for a file or workspace
 */
export async function getDiagnostics(
  file?: string
): Promise<DiagnosticInfo[]> {
  const diagnostics: DiagnosticInfo[] = [];
  
  // Run TypeScript compiler for type errors
  try {
    const tscCommand = file 
      ? `npx tsc --noEmit "${file}" 2>&1`
      : 'npx tsc --noEmit 2>&1';
    
    const { stdout } = await execAsync(tscCommand, {
      maxBuffer: 10 * 1024 * 1024,
    }).catch(e => ({ stdout: e.stdout || '', stderr: '' }));
    
    // Parse TSC output
    const errorPattern = /(.+)\((\d+),(\d+)\):\s+(error|warning)\s+(\w+):\s+(.+)/g;
    let match;
    
    while ((match = errorPattern.exec(stdout)) !== null) {
      diagnostics.push({
        file: match[1],
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        severity: match[4] as 'error' | 'warning',
        code: match[5],
        message: match[6],
        source: 'typescript',
      });
    }
  } catch (error) {
    logger.debug('TSC diagnostics failed:', error);
  }
  
  // Run ESLint
  try {
    const eslintCommand = file
      ? `npx eslint --format json "${file}" 2>/dev/null`
      : 'npx eslint --format json . 2>/dev/null';
    
    const { stdout } = await execAsync(eslintCommand, {
      maxBuffer: 10 * 1024 * 1024,
    }).catch(e => ({ stdout: e.stdout || '[]', stderr: '' }));
    
    const eslintResults = JSON.parse(stdout || '[]');
    
    for (const result of eslintResults) {
      for (const msg of result.messages || []) {
        diagnostics.push({
          file: result.filePath,
          line: msg.line || 1,
          column: msg.column || 1,
          severity: msg.severity === 2 ? 'error' : 'warning',
          code: msg.ruleId,
          message: msg.message,
          source: 'eslint',
        });
      }
    }
  } catch (error) {
    logger.debug('ESLint diagnostics failed:', error);
  }
  
  return diagnostics;
}

// ============================================================================
// Editor Operations
// ============================================================================

/**
 * Open a file in VS Code at a specific location
 */
export async function openFile(
  file: string,
  options?: {
    line?: number;
    column?: number;
    preview?: boolean;
  }
): Promise<boolean> {
  const { line, column, preview = false } = options || {};
  
  try {
    const args = [preview ? '--reuse-window' : '--goto'];
    
    if (line) {
      args.push(`"${file}:${line}${column ? `:${column}` : ''}"`);
    } else {
      args.push(`"${file}"`);
    }
    
    await executeVSCodeCommand('', args);
    return true;
  } catch (error) {
    logger.error('Failed to open file:', error);
    return false;
  }
}

/**
 * Create a new file with content
 */
export async function createFile(
  filePath: string,
  content: string
): Promise<boolean> {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, content, 'utf-8');
    await openFile(filePath);
    return true;
  } catch (error) {
    logger.error('Failed to create file:', error);
    return false;
  }
}

// ============================================================================
// Workspace Operations
// ============================================================================

/**
 * Get information about the current workspace
 */
export async function getWorkspaceInfo(): Promise<{
  folders: string[];
  files: number;
  languages: string[];
}> {
  const folders: string[] = [];
  const languages = new Set<string>();
  let fileCount = 0;
  
  // Count files and detect languages
  try {
    const { stdout } = await execAsync('find . -type f -name "*.*" | head -10000');
    const files = stdout.split('\n').filter(f => f.trim());
    fileCount = files.length;
    
    // Detect languages from extensions
    const extMap: Record<string, string> = {
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript React',
      '.js': 'JavaScript',
      '.jsx': 'JavaScript React',
      '.py': 'Python',
      '.go': 'Go',
      '.rs': 'Rust',
      '.java': 'Java',
      '.c': 'C',
      '.cpp': 'C++',
      '.cs': 'C#',
      '.rb': 'Ruby',
      '.php': 'PHP',
      '.swift': 'Swift',
      '.kt': 'Kotlin',
    };
    
    for (const file of files) {
      const ext = path.extname(file);
      if (extMap[ext]) {
        languages.add(extMap[ext]);
      }
    }
  } catch {
    // Fallback for Windows
    try {
      const { stdout } = await execAsync(
        'dir /s /b *.ts *.tsx *.js *.jsx *.py 2>nul | find /c /v ""'
      );
      fileCount = parseInt(stdout.trim()) || 0;
    } catch {
      // Ignore
    }
  }
  
  return {
    folders,
    files: fileCount,
    languages: Array.from(languages),
  };
}

// ============================================================================
// Tool Exports for Agent
// ============================================================================

export const vsCodeDeepTools = {
  /**
   * Find symbols in the codebase
   */
  find_symbol: {
    name: 'find_symbol',
    description: 'Find symbols (functions, classes, variables) in the codebase by name',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The symbol name or partial name to search for',
        },
        kind: {
          type: 'string',
          enum: ['function', 'class', 'interface', 'variable', 'constant', 'method'],
          description: 'Filter by symbol type',
        },
        file: {
          type: 'string',
          description: 'Optional file path to search within',
        },
      },
      required: ['query'],
    },
    execute: async (args: { query: string; kind?: string; file?: string }) => {
      const symbols = await findSymbols(args.query, {
        kind: args.kind as SymbolKind,
        file: args.file,
      });
      
      return {
        success: true,
        symbols: symbols.map(s => ({
          name: s.name,
          kind: s.kind,
          file: s.location.file,
          line: s.location.line,
          detail: s.detail,
        })),
      };
    },
  },
  
  /**
   * Find all references to a symbol
   */
  find_references: {
    name: 'find_references',
    description: 'Find all references to a symbol across the codebase',
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'The symbol name to find references for',
        },
        file: {
          type: 'string',
          description: 'Optional file path to search within',
        },
      },
      required: ['symbol'],
    },
    execute: async (args: { symbol: string; file?: string }) => {
      const references = await findReferences(args.symbol, {
        file: args.file,
      });
      
      return {
        success: true,
        count: references.length,
        references: references.map(r => ({
          file: r.location.file,
          line: r.location.line,
          context: r.context,
          isDefinition: r.isDefinition,
        })),
      };
    },
  },
  
  /**
   * Go to definition of a symbol
   */
  go_to_definition: {
    name: 'go_to_definition',
    description: 'Find and navigate to the definition of a symbol',
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'The symbol name to find the definition of',
        },
        fromFile: {
          type: 'string',
          description: 'Optional current file for context',
        },
      },
      required: ['symbol'],
    },
    execute: async (args: { symbol: string; fromFile?: string }) => {
      const location = await goToDefinition(args.symbol, args.fromFile);
      
      if (location) {
        await openFile(location.file, { line: location.line });
        return {
          success: true,
          location: {
            file: location.file,
            line: location.line,
            column: location.column,
          },
        };
      }
      
      return {
        success: false,
        error: `Definition for "${args.symbol}" not found`,
      };
    },
  },
  
  /**
   * Get code diagnostics (errors/warnings)
   */
  get_diagnostics: {
    name: 'get_diagnostics',
    description: 'Get code errors and warnings from TypeScript and ESLint',
    parameters: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Optional file path to check, or check entire workspace',
        },
      },
    },
    execute: async (args: { file?: string }) => {
      const diagnostics = await getDiagnostics(args.file);
      
      const errors = diagnostics.filter(d => d.severity === 'error');
      const warnings = diagnostics.filter(d => d.severity === 'warning');
      
      return {
        success: true,
        summary: {
          errors: errors.length,
          warnings: warnings.length,
        },
        diagnostics: diagnostics.map(d => ({
          file: d.file,
          line: d.line,
          severity: d.severity,
          message: d.message,
          source: d.source,
          code: d.code,
        })),
      };
    },
  },
  
  /**
   * Open a file in VS Code
   */
  open_in_editor: {
    name: 'open_in_editor',
    description: 'Open a file in VS Code, optionally at a specific line',
    parameters: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'The file path to open',
        },
        line: {
          type: 'number',
          description: 'Optional line number to navigate to',
        },
      },
      required: ['file'],
    },
    execute: async (args: { file: string; line?: number }) => {
      const success = await openFile(args.file, { line: args.line });
      return { success };
    },
  },
};

export default vsCodeDeepTools;
