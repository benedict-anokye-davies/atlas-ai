/**
 * Atlas Desktop - Code Refactoring Tools
 * 
 * Automated refactoring operations: extract functions, rename symbols,
 * inline variables, and code transformations.
 * 
 * @module agent/tools/code-refactor
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('CodeRefactor');

// ============================================================================
// 1. EXTRACT FUNCTION - Pull code into a new function
// ============================================================================

/**
 * Extract a code block into a new function
 */
export const extractFunctionTool: AgentTool = {
  name: 'extract_function',
  description: `Extract a block of code into a new function.
Automatically:
- Identifies variables that need to be parameters
- Determines return value
- Handles async/await preservation
- Updates the original location with a call`,
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'File path',
      },
      startLine: {
        type: 'number',
        description: 'Start line of code to extract',
      },
      endLine: {
        type: 'number',
        description: 'End line of code to extract',
      },
      functionName: {
        type: 'string',
        description: 'Name for the new function',
      },
      async: {
        type: 'boolean',
        description: 'Make the function async',
      },
    },
    required: ['file', 'startLine', 'endLine', 'functionName'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const filePath = params.file as string;
    const startLine = params.startLine as number;
    const endLine = params.endLine as number;
    const functionName = params.functionName as string;
    const isAsync = params.async as boolean;

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      // Extract the code block
      const extractedLines = lines.slice(startLine - 1, endLine);
      const extractedCode = extractedLines.join('\n');

      // Analyze the code to find:
      // 1. Variables used but defined outside (need to be parameters)
      // 2. Variables defined inside and used outside (need to be returned)
      const analysis = analyzeExtraction(extractedCode, lines, startLine, endLine);

      // Build the new function
      const asyncKeyword = isAsync || analysis.hasAwait ? 'async ' : '';
      const params_str = analysis.parameters.length > 0 
        ? analysis.parameters.join(', ') 
        : '';
      const returnType = analysis.returnVariables.length > 0
        ? analysis.returnVariables.length === 1
          ? analysis.returnVariables[0]
          : `{ ${analysis.returnVariables.join(', ')} }`
        : '';
      const returnStatement = returnType ? `\n  return ${returnType};` : '';

      // Indent the extracted code
      const indentedCode = extractedLines
        .map(line => '  ' + line.trim())
        .join('\n');

      const newFunction = `
${asyncKeyword}function ${functionName}(${params_str}) {
${indentedCode}${returnStatement}
}
`;

      // Build the replacement call
      const awaitKeyword = analysis.hasAwait ? 'await ' : '';
      const callParams = analysis.parameters.join(', ');
      let replacement: string;

      if (analysis.returnVariables.length === 0) {
        replacement = `${awaitKeyword}${functionName}(${callParams});`;
      } else if (analysis.returnVariables.length === 1) {
        replacement = `const ${analysis.returnVariables[0]} = ${awaitKeyword}${functionName}(${callParams});`;
      } else {
        replacement = `const { ${analysis.returnVariables.join(', ')} } = ${awaitKeyword}${functionName}(${callParams});`;
      }

      // Construct the new file content
      const beforeExtraction = lines.slice(0, startLine - 1);
      const afterExtraction = lines.slice(endLine);

      const newContent = [
        ...beforeExtraction,
        replacement,
        ...afterExtraction,
        newFunction,
      ].join('\n');

      // Write the file
      await fs.writeFile(filePath, newContent, 'utf-8');

      return {
        success: true,
        data: {
          file: filePath,
          functionName,
          parameters: analysis.parameters,
          returnVariables: analysis.returnVariables,
          linesExtracted: endLine - startLine + 1,
          preview: {
            function: newFunction.trim(),
            call: replacement,
          },
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

function analyzeExtraction(
  code: string,
  allLines: string[],
  startLine: number,
  endLine: number
): {
  parameters: string[];
  returnVariables: string[];
  hasAwait: boolean;
} {
  // Find all variable references in the extracted code
  const varPattern = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
  const usedVars = new Set<string>();
  let match;
  while ((match = varPattern.exec(code)) !== null) {
    const name = match[1];
    // Filter out keywords and common globals
    if (!isKeywordOrGlobal(name)) {
      usedVars.add(name);
    }
  }

  // Find variables defined in the extracted code
  const definedPattern = /\b(const|let|var)\s+(?:{([^}]+)}|(\w+))/g;
  const definedVars = new Set<string>();
  while ((match = definedPattern.exec(code)) !== null) {
    if (match[2]) {
      // Destructuring
      match[2].split(',').forEach(v => definedVars.add(v.trim().split(':')[0].trim()));
    } else if (match[3]) {
      definedVars.add(match[3]);
    }
  }

  // Find variables defined before the extraction
  const beforeCode = allLines.slice(0, startLine - 1).join('\n');
  const beforeDefinedVars = new Set<string>();
  while ((match = definedPattern.exec(beforeCode)) !== null) {
    if (match[2]) {
      match[2].split(',').forEach(v => beforeDefinedVars.add(v.trim().split(':')[0].trim()));
    } else if (match[3]) {
      beforeDefinedVars.add(match[3]);
    }
  }

  // Parameters: variables used but not defined in extraction, but defined before
  const parameters = Array.from(usedVars)
    .filter(v => !definedVars.has(v) && beforeDefinedVars.has(v));

  // Find variables used after the extraction
  const afterCode = allLines.slice(endLine).join('\n');
  const afterUsedVars = new Set<string>();
  const afterVarPattern = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
  while ((match = afterVarPattern.exec(afterCode)) !== null) {
    afterUsedVars.add(match[1]);
  }

  // Return variables: defined in extraction and used after
  const returnVariables = Array.from(definedVars)
    .filter(v => afterUsedVars.has(v));

  // Check for await
  const hasAwait = /\bawait\b/.test(code);

  return { parameters, returnVariables, hasAwait };
}

function isKeywordOrGlobal(name: string): boolean {
  const keywords = new Set([
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
    'return', 'throw', 'try', 'catch', 'finally', 'function', 'class', 'const',
    'let', 'var', 'new', 'this', 'super', 'import', 'export', 'default', 'from',
    'async', 'await', 'yield', 'typeof', 'instanceof', 'in', 'of', 'void',
    'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
    'console', 'window', 'document', 'global', 'process', 'require', 'module',
    'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Math', 'JSON',
    'Promise', 'Map', 'Set', 'Error', 'RegExp', 'Function',
  ]);
  return keywords.has(name);
}

// ============================================================================
// 2. RENAME SYMBOL - Rename across all files
// ============================================================================

/**
 * Rename a symbol (function, class, variable) across all files
 */
export const renameSymbolTool: AgentTool = {
  name: 'rename_symbol',
  description: `Rename a symbol across the entire codebase:
- Functions, classes, interfaces, types
- Variables and constants
- Updates all imports/exports
- Preserves string literals (won't rename inside strings)`,
  parameters: {
    type: 'object',
    properties: {
      oldName: {
        type: 'string',
        description: 'Current name of the symbol',
      },
      newName: {
        type: 'string',
        description: 'New name for the symbol',
      },
      directory: {
        type: 'string',
        description: 'Directory to search (default: current)',
      },
      preview: {
        type: 'boolean',
        description: 'Preview changes without applying',
      },
    },
    required: ['oldName', 'newName'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const oldName = params.oldName as string;
    const newName = params.newName as string;
    const directory = (params.directory as string) || process.cwd();
    const preview = (params.preview as boolean) ?? false;

    try {
      // Find all source files
      const files = await findSourceFilesRecursive(directory);
      
      const changes: Array<{
        file: string;
        line: number;
        before: string;
        after: string;
      }> = [];

      // Process each file
      for (const file of files) {
        const content = await fs.readFile(file, 'utf-8');
        const lines = content.split('\n');
        let modified = false;
        const newLines: string[] = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          
          // Create pattern that matches whole words only, not inside strings
          const pattern = new RegExp(`\\b${escapeRegex(oldName)}\\b`, 'g');
          
          // Skip if the match is inside a string
          const newLine = replaceOutsideStrings(line, pattern, newName);
          
          if (newLine !== line) {
            changes.push({
              file: path.relative(directory, file),
              line: i + 1,
              before: line.trim(),
              after: newLine.trim(),
            });
            modified = true;
          }
          
          newLines.push(newLine);
        }

        // Write changes if not preview mode
        if (modified && !preview) {
          await fs.writeFile(file, newLines.join('\n'), 'utf-8');
        }
      }

      return {
        success: true,
        data: {
          oldName,
          newName,
          filesScanned: files.length,
          filesModified: new Set(changes.map(c => c.file)).size,
          totalChanges: changes.length,
          preview,
          changes: changes.slice(0, 50), // Limit preview
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceOutsideStrings(line: string, pattern: RegExp, replacement: string): string {
  // Split by strings and only replace in non-string parts
  const stringPattern = /(['"`])(?:(?!\1|\\).|\\.)*\1/g;
  const strings: string[] = [];
  let result = line.replace(stringPattern, (match) => {
    strings.push(match);
    return `__STRING_${strings.length - 1}__`;
  });

  // Replace in non-string parts
  result = result.replace(pattern, replacement);

  // Restore strings
  for (let i = 0; i < strings.length; i++) {
    result = result.replace(`__STRING_${i}__`, strings[i]);
  }

  return result;
}

// ============================================================================
// 3. INLINE VARIABLE - Replace variable with its value
// ============================================================================

/**
 * Inline a variable (replace all usages with its value)
 */
export const inlineVariableTool: AgentTool = {
  name: 'inline_variable',
  description: `Inline a variable - replace all usages with its value.
Useful for:
- Removing unnecessary intermediate variables
- Simplifying code
- Preparing for further refactoring`,
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'File path',
      },
      variableName: {
        type: 'string',
        description: 'Name of the variable to inline',
      },
      line: {
        type: 'number',
        description: 'Line where variable is defined (for disambiguation)',
      },
    },
    required: ['file', 'variableName'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const filePath = params.file as string;
    const variableName = params.variableName as string;
    const targetLine = params.line as number | undefined;

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      // Find the variable definition
      const defPattern = new RegExp(
        `(const|let|var)\\s+${escapeRegex(variableName)}\\s*=\\s*(.+?)(?:;|$)`
      );

      let defLine = -1;
      let value = '';

      for (let i = 0; i < lines.length; i++) {
        if (targetLine && i + 1 !== targetLine) continue;

        const match = lines[i].match(defPattern);
        if (match) {
          defLine = i;
          value = match[2].trim();
          break;
        }
      }

      if (defLine === -1) {
        return { success: false, error: `Variable '${variableName}' not found` };
      }

      // Check if value is simple enough to inline
      const needsParens = /[+\-*/%<>=&|^?:]/.test(value) && !value.startsWith('(');
      const inlineValue = needsParens ? `(${value})` : value;

      // Replace all usages
      const usagePattern = new RegExp(`\\b${escapeRegex(variableName)}\\b`, 'g');
      let replacements = 0;
      const newLines: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        if (i === defLine) {
          // Remove the definition line
          continue;
        }

        const newLine = replaceOutsideStrings(lines[i], usagePattern, inlineValue);
        if (newLine !== lines[i]) {
          replacements++;
        }
        newLines.push(newLine);
      }

      await fs.writeFile(filePath, newLines.join('\n'), 'utf-8');

      return {
        success: true,
        data: {
          file: filePath,
          variableName,
          inlinedValue: value,
          replacements,
          definitionRemoved: true,
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

// ============================================================================
// 4. ADD/UPDATE IMPORTS
// ============================================================================

/**
 * Add or update import statements
 */
export const manageImportsTool: AgentTool = {
  name: 'manage_imports',
  description: `Manage import statements:
- Add new imports
- Remove unused imports
- Sort and organize imports
- Convert between import styles`,
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'File path',
      },
      action: {
        type: 'string',
        enum: ['add', 'remove', 'organize', 'removeUnused'],
        description: 'Action to perform',
      },
      imports: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            from: { type: 'string' },
            default: { type: 'boolean' },
          },
        },
        description: 'Imports to add/remove',
      },
    },
    required: ['file', 'action'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const filePath = params.file as string;
    const action = params.action as string;
    const importsToManage = params.imports as Array<{ name: string; from: string; default?: boolean }> | undefined;

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      // Parse existing imports
      const existingImports = parseImports(lines);
      let newContent: string;

      switch (action) {
        case 'add':
          if (!importsToManage) {
            return { success: false, error: 'No imports specified' };
          }
          newContent = addImports(content, importsToManage);
          break;

        case 'remove':
          if (!importsToManage) {
            return { success: false, error: 'No imports specified' };
          }
          newContent = removeImports(content, importsToManage);
          break;

        case 'organize':
          newContent = organizeImports(content, existingImports);
          break;

        case 'removeUnused':
          newContent = removeUnusedImports(content, existingImports);
          break;

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }

      await fs.writeFile(filePath, newContent, 'utf-8');

      return {
        success: true,
        data: {
          file: filePath,
          action,
          importsModified: true,
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

interface ParsedImport {
  line: number;
  full: string;
  names: string[];
  from: string;
  isDefault: boolean;
}

function parseImports(lines: string[]): ParsedImport[] {
  const imports: ParsedImport[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Named imports
    const namedMatch = line.match(/import\s*{([^}]+)}\s*from\s*['"]([^'"]+)['"]/);
    if (namedMatch) {
      imports.push({
        line: i,
        full: line,
        names: namedMatch[1].split(',').map(n => n.trim()),
        from: namedMatch[2],
        isDefault: false,
      });
      continue;
    }

    // Default imports
    const defaultMatch = line.match(/import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/);
    if (defaultMatch) {
      imports.push({
        line: i,
        full: line,
        names: [defaultMatch[1]],
        from: defaultMatch[2],
        isDefault: true,
      });
    }
  }

  return imports;
}

function addImports(content: string, imports: Array<{ name: string; from: string; default?: boolean }>): string {
  const lines = content.split('\n');
  
  // Find the last import line
  let lastImportLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^import\s/.test(lines[i])) {
      lastImportLine = i;
    }
  }

  // Group imports by source
  const importsBySource = new Map<string, { names: string[]; default?: string }>();
  for (const imp of imports) {
    if (!importsBySource.has(imp.from)) {
      importsBySource.set(imp.from, { names: [] });
    }
    const entry = importsBySource.get(imp.from)!;
    if (imp.default) {
      entry.default = imp.name;
    } else {
      entry.names.push(imp.name);
    }
  }

  // Generate import statements
  const newImports: string[] = [];
  for (const [from, { names, default: defaultImport }] of importsBySource) {
    let statement = 'import ';
    if (defaultImport && names.length > 0) {
      statement += `${defaultImport}, { ${names.join(', ')} }`;
    } else if (defaultImport) {
      statement += defaultImport;
    } else {
      statement += `{ ${names.join(', ')} }`;
    }
    statement += ` from '${from}';`;
    newImports.push(statement);
  }

  // Insert imports
  const insertLine = lastImportLine >= 0 ? lastImportLine + 1 : 0;
  lines.splice(insertLine, 0, ...newImports);

  return lines.join('\n');
}

function removeImports(content: string, imports: Array<{ name: string; from: string }>): string {
  let result = content;

  for (const imp of imports) {
    // Remove from named imports
    const namedPattern = new RegExp(
      `(import\\s*{[^}]*?)\\b${escapeRegex(imp.name)}\\b,?\\s*([^}]*}\\s*from\\s*['"]${escapeRegex(imp.from)}['"])`,
      'g'
    );
    result = result.replace(namedPattern, '$1$2');

    // Clean up empty imports
    result = result.replace(/import\s*{\s*}\s*from\s*['"][^'"]+['"];?\n?/g, '');
    result = result.replace(/,\s*}/g, ' }');
    result = result.replace(/{\s*,/g, '{ ');
  }

  return result;
}

function organizeImports(content: string, imports: ParsedImport[]): string {
  if (imports.length === 0) return content;

  const lines = content.split('\n');
  
  // Remove existing import lines
  const nonImportLines = lines.filter((_, i) => !imports.some(imp => imp.line === i));

  // Sort imports: node_modules first, then relative
  const nodeModuleImports = imports.filter(i => !i.from.startsWith('.'));
  const relativeImports = imports.filter(i => i.from.startsWith('.'));

  nodeModuleImports.sort((a, b) => a.from.localeCompare(b.from));
  relativeImports.sort((a, b) => a.from.localeCompare(b.from));

  const sortedImports = [...nodeModuleImports, ...relativeImports];
  const importLines = sortedImports.map(i => i.full);

  // Insert sorted imports at the top
  const hasShebang = nonImportLines[0]?.startsWith('#!');
  const insertIndex = hasShebang ? 1 : 0;

  return [
    ...nonImportLines.slice(0, insertIndex),
    ...importLines,
    '',
    ...nonImportLines.slice(insertIndex),
  ].join('\n');
}

function removeUnusedImports(content: string, imports: ParsedImport[]): string {
  const lines = content.split('\n');
  const bodyContent = lines.slice(imports.length > 0 ? imports[imports.length - 1].line + 1 : 0).join('\n');

  const linesToRemove = new Set<number>();

  for (const imp of imports) {
    const unusedNames = imp.names.filter(name => {
      const pattern = new RegExp(`\\b${escapeRegex(name)}\\b`);
      return !pattern.test(bodyContent);
    });

    if (unusedNames.length === imp.names.length) {
      // All names unused, remove entire import
      linesToRemove.add(imp.line);
    } else if (unusedNames.length > 0) {
      // Some names unused, update the import
      const remainingNames = imp.names.filter(n => !unusedNames.includes(n));
      lines[imp.line] = `import { ${remainingNames.join(', ')} } from '${imp.from}';`;
    }
  }

  return lines.filter((_, i) => !linesToRemove.has(i)).join('\n');
}

// ============================================================================
// 5. CONVERT CODE STYLE
// ============================================================================

/**
 * Convert between code styles (arrow functions, async/await, etc.)
 */
export const convertStyleTool: AgentTool = {
  name: 'convert_style',
  description: `Convert code between different styles:
- Regular functions ↔ Arrow functions
- Promises (.then) ↔ async/await
- var ↔ const/let
- CommonJS ↔ ES modules`,
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'File path',
      },
      conversion: {
        type: 'string',
        enum: [
          'functions-to-arrows',
          'arrows-to-functions',
          'promises-to-async',
          'var-to-const',
          'commonjs-to-esm',
          'esm-to-commonjs',
        ],
        description: 'Type of conversion',
      },
    },
    required: ['file', 'conversion'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const filePath = params.file as string;
    const conversion = params.conversion as string;

    try {
      let content = await fs.readFile(filePath, 'utf-8');
      let conversions = 0;

      switch (conversion) {
        case 'functions-to-arrows': {
          // Convert function declarations to arrow functions
          content = content.replace(
            /function\s+(\w+)\s*\(([^)]*)\)\s*{/g,
            (_, name, params) => {
              conversions++;
              return `const ${name} = (${params}) => {`;
            }
          );
          break;
        }

        case 'arrows-to-functions': {
          // Convert arrow functions to regular functions
          content = content.replace(
            /const\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>\s*{/g,
            (match, name, params) => {
              conversions++;
              const isAsync = match.includes('async');
              return `${isAsync ? 'async ' : ''}function ${name}(${params}) {`;
            }
          );
          break;
        }

        case 'var-to-const': {
          // Convert var to const/let
          content = content.replace(
            /\bvar\s+(\w+)\s*=/g,
            (_, name) => {
              conversions++;
              return `const ${name} =`;
            }
          );
          break;
        }

        case 'commonjs-to-esm': {
          // Convert require to import
          content = content.replace(
            /const\s+(\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
            (_, name, path) => {
              conversions++;
              return `import ${name} from '${path}'`;
            }
          );
          content = content.replace(
            /const\s*{\s*([^}]+)\s*}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
            (_, names, path) => {
              conversions++;
              return `import { ${names} } from '${path}'`;
            }
          );
          // Convert module.exports
          content = content.replace(
            /module\.exports\s*=\s*/g,
            () => {
              conversions++;
              return 'export default ';
            }
          );
          break;
        }

        case 'esm-to-commonjs': {
          // Convert import to require
          content = content.replace(
            /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g,
            (_, name, path) => {
              conversions++;
              return `const ${name} = require('${path}')`;
            }
          );
          content = content.replace(
            /import\s*{\s*([^}]+)\s*}\s*from\s*['"]([^'"]+)['"]/g,
            (_, names, path) => {
              conversions++;
              return `const { ${names} } = require('${path}')`;
            }
          );
          // Convert export default
          content = content.replace(
            /export\s+default\s+/g,
            () => {
              conversions++;
              return 'module.exports = ';
            }
          );
          break;
        }

        default:
          return { success: false, error: `Unknown conversion: ${conversion}` };
      }

      await fs.writeFile(filePath, content, 'utf-8');

      return {
        success: true,
        data: {
          file: filePath,
          conversion,
          conversions,
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function findSourceFilesRecursive(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      files.push(...await findSourceFilesRecursive(fullPath));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

// ============================================================================
// EXPORTS
// ============================================================================

export function getCodeRefactorTools(): AgentTool[] {
  return [
    extractFunctionTool,
    renameSymbolTool,
    inlineVariableTool,
    manageImportsTool,
    convertStyleTool,
  ];
}

export default {
  extractFunctionTool,
  renameSymbolTool,
  inlineVariableTool,
  manageImportsTool,
  convertStyleTool,
  getCodeRefactorTools,
};
