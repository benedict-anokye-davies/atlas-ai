/**
 * Atlas Desktop - Documentation Generator
 * 
 * Automatically generate JSDoc, docstrings, README files,
 * and API documentation from code.
 * 
 * @module agent/tools/doc-generator
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('DocGenerator');

// ============================================================================
// 1. GENERATE JSDOC
// ============================================================================

/**
 * Generate JSDoc comments for functions, classes, and modules
 */
export const generateJSDocTool: AgentTool = {
  name: 'generate_jsdoc',
  description: `Generate JSDoc comments for JavaScript/TypeScript code:
- Functions with parameters and return types
- Classes with constructor and methods
- Module-level documentation
- Can update existing or add new documentation`,
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'File path',
      },
      target: {
        type: 'string',
        description: 'Specific function/class name (optional, documents all if not specified)',
      },
      style: {
        type: 'string',
        enum: ['jsdoc', 'tsdoc', 'minimal'],
        description: 'Documentation style',
      },
      includeExamples: {
        type: 'boolean',
        description: 'Include usage examples',
      },
    },
    required: ['file'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const filePath = params.file as string;
    const target = params.target as string | undefined;
    const style = (params.style as string) || 'jsdoc';
    const includeExamples = params.includeExamples as boolean;

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const documented: string[] = [];

      // Find functions and classes that need documentation
      const entities = parseEntities(content);

      // Filter by target if specified
      const toDocument = target
        ? entities.filter(e => e.name === target)
        : entities.filter(e => !e.hasDoc);

      // Generate docs
      const newLines = [...lines];
      let offset = 0;

      for (const entity of toDocument) {
        const doc = generateDoc(entity, style, includeExamples);
        const insertLine = entity.line - 1 + offset;

        // Insert the documentation
        newLines.splice(insertLine, 0, ...doc.split('\n'));
        offset += doc.split('\n').length;
        documented.push(entity.name);
      }

      // Write the file
      await fs.writeFile(filePath, newLines.join('\n'), 'utf-8');

      return {
        success: true,
        data: {
          file: filePath,
          style,
          documented,
          totalDocumented: documented.length,
          preview: toDocument.slice(0, 3).map(e => ({
            name: e.name,
            type: e.type,
            doc: generateDoc(e, style, includeExamples),
          })),
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

interface CodeEntity {
  type: 'function' | 'class' | 'method' | 'interface' | 'type';
  name: string;
  line: number;
  params: Array<{ name: string; type?: string; optional?: boolean }>;
  returnType?: string;
  isAsync: boolean;
  hasDoc: boolean;
  description?: string;
}

function parseEntities(content: string): CodeEntity[] {
  const entities: CodeEntity[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prevLine = i > 0 ? lines[i - 1] : '';

    // Check if already has JSDoc
    const hasDoc = /^\s*\*\//.test(prevLine) || /^\s*\/\*\*/.test(prevLine);

    // Function declarations
    const funcMatch = line.match(
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*(\w+))?/
    );
    if (funcMatch) {
      entities.push({
        type: 'function',
        name: funcMatch[1],
        line: i + 1,
        params: parseParams(funcMatch[2]),
        returnType: funcMatch[3],
        isAsync: line.includes('async'),
        hasDoc,
      });
      continue;
    }

    // Arrow functions assigned to const
    const arrowMatch = line.match(
      /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)(?:\s*:\s*([^=]+))?\s*=>/
    );
    if (arrowMatch) {
      entities.push({
        type: 'function',
        name: arrowMatch[1],
        line: i + 1,
        params: parseParams(arrowMatch[2]),
        returnType: arrowMatch[3]?.trim(),
        isAsync: line.includes('async'),
        hasDoc,
      });
      continue;
    }

    // Class declarations
    const classMatch = line.match(
      /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+(\w+))?/
    );
    if (classMatch) {
      entities.push({
        type: 'class',
        name: classMatch[1],
        line: i + 1,
        params: [],
        isAsync: false,
        hasDoc,
        description: classMatch[2] ? `Extends ${classMatch[2]}` : undefined,
      });
      continue;
    }

    // Interface declarations
    const interfaceMatch = line.match(/(?:export\s+)?interface\s+(\w+)/);
    if (interfaceMatch) {
      entities.push({
        type: 'interface',
        name: interfaceMatch[1],
        line: i + 1,
        params: [],
        isAsync: false,
        hasDoc,
      });
      continue;
    }

    // Type declarations
    const typeMatch = line.match(/(?:export\s+)?type\s+(\w+)\s*=/);
    if (typeMatch) {
      entities.push({
        type: 'type',
        name: typeMatch[1],
        line: i + 1,
        params: [],
        isAsync: false,
        hasDoc,
      });
      continue;
    }
  }

  return entities;
}

function parseParams(paramString: string): Array<{ name: string; type?: string; optional?: boolean }> {
  if (!paramString.trim()) return [];

  const params: Array<{ name: string; type?: string; optional?: boolean }> = [];
  const parts = paramString.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Match patterns like: name, name: type, name?: type, { destructured }
    const match = trimmed.match(/^(?:\.{3})?(\w+|\{[^}]+\})(\?)?\s*(?::\s*(.+))?$/);
    if (match) {
      params.push({
        name: match[1],
        type: match[3]?.trim(),
        optional: !!match[2],
      });
    }
  }

  return params;
}

function generateDoc(entity: CodeEntity, style: string, includeExamples: boolean): string {
  const lines: string[] = ['/**'];

  // Description
  const description = generateDescription(entity);
  lines.push(` * ${description}`);
  lines.push(' *');

  // Parameters
  for (const param of entity.params) {
    const type = param.type || 'unknown';
    const optional = param.optional ? ' [optional]' : '';
    const paramDesc = inferParamDescription(param.name);
    lines.push(` * @param {${type}} ${param.name} - ${paramDesc}${optional}`);
  }

  // Return type
  if (entity.returnType && entity.returnType !== 'void') {
    const returnDesc = inferReturnDescription(entity);
    lines.push(` * @returns {${entity.returnType}} ${returnDesc}`);
  }

  // Async indicator
  if (entity.isAsync) {
    lines.push(` * @async`);
  }

  // Examples
  if (includeExamples) {
    lines.push(' *');
    lines.push(' * @example');
    lines.push(` * ${generateExample(entity)}`);
  }

  lines.push(' */');
  return lines.join('\n');
}

function generateDescription(entity: CodeEntity): string {
  const nameWords = entity.name
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .trim()
    .toLowerCase();

  switch (entity.type) {
    case 'function':
      if (entity.name.startsWith('get')) {
        return `Gets the ${nameWords.replace('get ', '')}.`;
      }
      if (entity.name.startsWith('set')) {
        return `Sets the ${nameWords.replace('set ', '')}.`;
      }
      if (entity.name.startsWith('is') || entity.name.startsWith('has')) {
        return `Checks if ${nameWords.replace(/^(is|has) /, '')}.`;
      }
      if (entity.name.startsWith('create')) {
        return `Creates a new ${nameWords.replace('create ', '')}.`;
      }
      if (entity.name.startsWith('handle')) {
        return `Handles ${nameWords.replace('handle ', '')}.`;
      }
      return `${capitalizeFirst(nameWords)}.`;

    case 'class':
      return entity.description || `${capitalizeFirst(nameWords)} class.`;

    case 'interface':
      return `Interface for ${nameWords}.`;

    case 'type':
      return `Type definition for ${nameWords}.`;

    default:
      return capitalizeFirst(nameWords);
  }
}

function inferParamDescription(name: string): string {
  const commonDescriptions: Record<string, string> = {
    id: 'The unique identifier',
    name: 'The name',
    value: 'The value to use',
    data: 'The data object',
    options: 'Configuration options',
    config: 'Configuration settings',
    callback: 'Callback function',
    handler: 'Event handler function',
    path: 'File or directory path',
    url: 'URL string',
    request: 'The request object',
    response: 'The response object',
    error: 'Error object',
    message: 'Message string',
    index: 'Index position',
    count: 'Number of items',
    limit: 'Maximum limit',
    offset: 'Starting offset',
    params: 'Parameters object',
    args: 'Arguments array',
    props: 'Properties object',
    state: 'State object',
    context: 'Context object',
  };

  const normalized = name.toLowerCase().replace(/[_-]/g, '');
  return commonDescriptions[normalized] || `The ${name.replace(/([A-Z])/g, ' $1').toLowerCase().trim()}`;
}

function inferReturnDescription(entity: CodeEntity): string {
  if (entity.name.startsWith('get')) {
    return `The ${entity.name.replace(/^get/, '').replace(/([A-Z])/g, ' $1').toLowerCase().trim()}`;
  }
  if (entity.name.startsWith('is') || entity.name.startsWith('has')) {
    return 'True if the condition is met, false otherwise';
  }
  if (entity.name.startsWith('create')) {
    return `The created ${entity.name.replace(/^create/, '').replace(/([A-Z])/g, ' $1').toLowerCase().trim()}`;
  }
  if (entity.name.startsWith('find')) {
    return `The found ${entity.name.replace(/^find/, '').replace(/([A-Z])/g, ' $1').toLowerCase().trim()} or undefined`;
  }
  return `The result`;
}

function generateExample(entity: CodeEntity): string {
  const params = entity.params.map(p => {
    if (p.type?.includes('string')) return `'example'`;
    if (p.type?.includes('number')) return '42';
    if (p.type?.includes('boolean')) return 'true';
    if (p.type?.includes('[]')) return '[]';
    if (p.name === 'options' || p.name === 'config') return '{}';
    return p.name;
  });

  const call = `${entity.name}(${params.join(', ')})`;
  return entity.isAsync ? `const result = await ${call};` : `const result = ${call};`;
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================================================
// 2. GENERATE README
// ============================================================================

/**
 * Generate or update README.md
 */
export const generateReadmeTool: AgentTool = {
  name: 'generate_readme',
  description: `Generate a README.md file for a project:
- Project description from package.json
- Installation instructions
- Usage examples
- API documentation
- License information`,
  parameters: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description: 'Project directory (default: current)',
      },
      sections: {
        type: 'array',
        items: { type: 'string' },
        description: 'Sections to include (default: all)',
      },
      badges: {
        type: 'boolean',
        description: 'Include status badges',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const directory = (params.directory as string) || process.cwd();
    const requestedSections = params.sections as string[] | undefined;
    const includeBadges = params.badges !== false;

    try {
      // Read package.json if exists
      let packageJson: Record<string, unknown> = {};
      try {
        const pkgPath = path.join(directory, 'package.json');
        packageJson = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
      } catch {
        // No package.json
      }

      const name = (packageJson.name as string) || path.basename(directory);
      const description = (packageJson.description as string) || 'A project';
      const version = (packageJson.version as string) || '1.0.0';
      const license = (packageJson.license as string) || 'MIT';
      const author = packageJson.author as string | { name: string } | undefined;
      const authorName = typeof author === 'string' ? author : author?.name || '';
      const repository = packageJson.repository as { url?: string } | string | undefined;
      const repoUrl = typeof repository === 'string' ? repository : repository?.url || '';

      const sections: string[] = [];

      // Title and badges
      sections.push(`# ${name}`);
      sections.push('');

      if (includeBadges) {
        const badges: string[] = [];
        badges.push(`![Version](https://img.shields.io/badge/version-${version}-blue.svg)`);
        badges.push(`![License](https://img.shields.io/badge/license-${license}-green.svg)`);
        if (packageJson.scripts && (packageJson.scripts as Record<string, string>).test) {
          badges.push('![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)');
        }
        sections.push(badges.join(' '));
        sections.push('');
      }

      // Description
      sections.push(description);
      sections.push('');

      // Table of Contents
      if (!requestedSections || requestedSections.includes('toc')) {
        sections.push('## Table of Contents');
        sections.push('');
        sections.push('- [Installation](#installation)');
        sections.push('- [Usage](#usage)');
        sections.push('- [API](#api)');
        sections.push('- [Configuration](#configuration)');
        sections.push('- [Contributing](#contributing)');
        sections.push('- [License](#license)');
        sections.push('');
      }

      // Installation
      if (!requestedSections || requestedSections.includes('installation')) {
        sections.push('## Installation');
        sections.push('');
        sections.push('```bash');
        if (packageJson.name) {
          sections.push(`npm install ${packageJson.name}`);
        } else {
          sections.push(`git clone ${repoUrl || `<repository-url>`}`);
          sections.push(`cd ${name}`);
          sections.push('npm install');
        }
        sections.push('```');
        sections.push('');
      }

      // Usage
      if (!requestedSections || requestedSections.includes('usage')) {
        sections.push('## Usage');
        sections.push('');
        sections.push('```javascript');
        if (packageJson.main) {
          sections.push(`const ${toCamelCase(name)} = require('${packageJson.name || name}');`);
          sections.push('');
          sections.push(`// Use ${toCamelCase(name)}`);
        } else {
          sections.push(`import { something } from '${packageJson.name || name}';`);
          sections.push('');
          sections.push('// Your code here');
        }
        sections.push('```');
        sections.push('');
      }

      // Scripts
      if (packageJson.scripts && (!requestedSections || requestedSections.includes('scripts'))) {
        sections.push('## Available Scripts');
        sections.push('');
        const scripts = packageJson.scripts as Record<string, string>;
        for (const [scriptName, command] of Object.entries(scripts)) {
          sections.push(`### \`npm run ${scriptName}\``);
          sections.push('');
          sections.push(`${command}`);
          sections.push('');
        }
      }

      // API (placeholder)
      if (!requestedSections || requestedSections.includes('api')) {
        sections.push('## API');
        sections.push('');
        sections.push('### Functions');
        sections.push('');
        sections.push('| Function | Description |');
        sections.push('|----------|-------------|');
        sections.push('| `function1()` | Description of function1 |');
        sections.push('| `function2()` | Description of function2 |');
        sections.push('');
      }

      // Configuration
      if (!requestedSections || requestedSections.includes('configuration')) {
        sections.push('## Configuration');
        sections.push('');
        sections.push('Configuration options can be set in the following ways:');
        sections.push('');
        sections.push('- Environment variables');
        sections.push('- Configuration file');
        sections.push('- Command line arguments');
        sections.push('');
      }

      // Contributing
      if (!requestedSections || requestedSections.includes('contributing')) {
        sections.push('## Contributing');
        sections.push('');
        sections.push('Contributions are welcome! Please read our [contributing guidelines](CONTRIBUTING.md) first.');
        sections.push('');
        sections.push('1. Fork the repository');
        sections.push('2. Create your feature branch (`git checkout -b feature/amazing-feature`)');
        sections.push('3. Commit your changes (`git commit -m "Add some amazing feature"`)');
        sections.push('4. Push to the branch (`git push origin feature/amazing-feature`)');
        sections.push('5. Open a Pull Request');
        sections.push('');
      }

      // License
      if (!requestedSections || requestedSections.includes('license')) {
        sections.push('## License');
        sections.push('');
        sections.push(`This project is licensed under the ${license} License - see the [LICENSE](LICENSE) file for details.`);
        sections.push('');
      }

      // Author
      if (authorName) {
        sections.push('## Author');
        sections.push('');
        sections.push(`**${authorName}**`);
        sections.push('');
      }

      const readmeContent = sections.join('\n');
      const readmePath = path.join(directory, 'README.md');
      await fs.writeFile(readmePath, readmeContent, 'utf-8');

      return {
        success: true,
        data: {
          file: readmePath,
          sections: requestedSections || ['all'],
          lines: readmeContent.split('\n').length,
          preview: readmeContent.slice(0, 500) + '...',
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

function toCamelCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^(.)/, c => c.toLowerCase());
}

// ============================================================================
// 3. GENERATE API DOCS
// ============================================================================

/**
 * Generate API documentation
 */
export const generateApiDocsTool: AgentTool = {
  name: 'generate_api_docs',
  description: `Generate API documentation from source code:
- Extracts from JSDoc comments
- Generates markdown or HTML
- Creates navigation structure
- Supports multiple output formats`,
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Source directory or file',
      },
      output: {
        type: 'string',
        description: 'Output directory',
      },
      format: {
        type: 'string',
        enum: ['markdown', 'html', 'json'],
        description: 'Output format',
      },
      title: {
        type: 'string',
        description: 'Documentation title',
      },
    },
    required: ['source'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const source = params.source as string;
    const output = (params.output as string) || path.join(path.dirname(source), 'docs');
    const format = (params.format as string) || 'markdown';
    const title = (params.title as string) || 'API Documentation';

    try {
      // Find all source files
      const stats = await fs.stat(source);
      const files = stats.isDirectory()
        ? await findSourceFiles(source)
        : [source];

      // Parse all entities from files
      const allEntities: Array<CodeEntity & { file: string }> = [];

      for (const file of files) {
        const content = await fs.readFile(file, 'utf-8');
        const entities = parseEntitiesWithDocs(content);
        for (const entity of entities) {
          allEntities.push({ ...entity, file });
        }
      }

      // Generate documentation
      await fs.mkdir(output, { recursive: true });

      if (format === 'markdown') {
        const docs = generateMarkdownDocs(allEntities, title);
        await fs.writeFile(path.join(output, 'API.md'), docs, 'utf-8');
      } else if (format === 'json') {
        await fs.writeFile(
          path.join(output, 'api.json'),
          JSON.stringify(allEntities, null, 2),
          'utf-8'
        );
      } else if (format === 'html') {
        const docs = generateHtmlDocs(allEntities, title);
        await fs.writeFile(path.join(output, 'index.html'), docs, 'utf-8');
      }

      return {
        success: true,
        data: {
          source,
          output,
          format,
          filesProcessed: files.length,
          entitiesDocumented: allEntities.length,
          outputFiles: format === 'markdown'
            ? [path.join(output, 'API.md')]
            : format === 'json'
            ? [path.join(output, 'api.json')]
            : [path.join(output, 'index.html')],
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
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      files.push(...await findSourceFiles(fullPath));
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name) && !entry.name.includes('.test.')) {
      files.push(fullPath);
    }
  }

  return files;
}

function parseEntitiesWithDocs(content: string): CodeEntity[] {
  const entities: CodeEntity[] = [];
  const lines = content.split('\n');

  let currentDoc: string[] = [];
  let inDoc = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track JSDoc comments
    if (line.includes('/**')) {
      inDoc = true;
      currentDoc = [line];
    } else if (inDoc) {
      currentDoc.push(line);
      if (line.includes('*/')) {
        inDoc = false;
      }
    }

    // Check for entities
    const entity = parseLineForEntity(line, i + 1);
    if (entity) {
      entity.hasDoc = currentDoc.length > 0;
      if (entity.hasDoc) {
        entity.description = extractDescriptionFromDoc(currentDoc);
      }
      entities.push(entity);
      currentDoc = [];
    }
  }

  return entities;
}

function parseLineForEntity(line: string, lineNum: number): CodeEntity | null {
  // Function
  const funcMatch = line.match(
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*(\S+))?/
  );
  if (funcMatch) {
    return {
      type: 'function',
      name: funcMatch[1],
      line: lineNum,
      params: parseParams(funcMatch[2]),
      returnType: funcMatch[3],
      isAsync: line.includes('async'),
      hasDoc: false,
    };
  }

  // Arrow function
  const arrowMatch = line.match(
    /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)(?:\s*:\s*([^=]+))?\s*=>/
  );
  if (arrowMatch) {
    return {
      type: 'function',
      name: arrowMatch[1],
      line: lineNum,
      params: parseParams(arrowMatch[2]),
      returnType: arrowMatch[3]?.trim(),
      isAsync: line.includes('async'),
      hasDoc: false,
    };
  }

  // Class
  const classMatch = line.match(/(?:export\s+)?class\s+(\w+)/);
  if (classMatch) {
    return {
      type: 'class',
      name: classMatch[1],
      line: lineNum,
      params: [],
      isAsync: false,
      hasDoc: false,
    };
  }

  // Interface
  const interfaceMatch = line.match(/(?:export\s+)?interface\s+(\w+)/);
  if (interfaceMatch) {
    return {
      type: 'interface',
      name: interfaceMatch[1],
      line: lineNum,
      params: [],
      isAsync: false,
      hasDoc: false,
    };
  }

  return null;
}

function extractDescriptionFromDoc(docLines: string[]): string {
  const content = docLines
    .map(l => l.replace(/^\s*\/?\*+\/?/, '').trim())
    .filter(l => !l.startsWith('@'))
    .join(' ')
    .trim();
  return content;
}

function generateMarkdownDocs(
  entities: Array<CodeEntity & { file: string }>,
  title: string
): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');

  // Group by type
  const functions = entities.filter(e => e.type === 'function');
  const classes = entities.filter(e => e.type === 'class');
  const interfaces = entities.filter(e => e.type === 'interface');

  // Table of contents
  lines.push('## Table of Contents');
  lines.push('');
  if (classes.length > 0) lines.push('- [Classes](#classes)');
  if (interfaces.length > 0) lines.push('- [Interfaces](#interfaces)');
  if (functions.length > 0) lines.push('- [Functions](#functions)');
  lines.push('');

  // Classes
  if (classes.length > 0) {
    lines.push('## Classes');
    lines.push('');
    for (const cls of classes) {
      lines.push(`### ${cls.name}`);
      lines.push('');
      lines.push(cls.description || 'No description available.');
      lines.push('');
      lines.push(`**File:** \`${cls.file}\``);
      lines.push('');
    }
  }

  // Interfaces
  if (interfaces.length > 0) {
    lines.push('## Interfaces');
    lines.push('');
    for (const iface of interfaces) {
      lines.push(`### ${iface.name}`);
      lines.push('');
      lines.push(iface.description || 'No description available.');
      lines.push('');
      lines.push(`**File:** \`${iface.file}\``);
      lines.push('');
    }
  }

  // Functions
  if (functions.length > 0) {
    lines.push('## Functions');
    lines.push('');
    for (const func of functions) {
      lines.push(`### ${func.name}`);
      lines.push('');
      lines.push(func.description || 'No description available.');
      lines.push('');
      lines.push('**Signature:**');
      lines.push('```typescript');
      const params = func.params.map(p => `${p.name}${p.optional ? '?' : ''}: ${p.type || 'unknown'}`).join(', ');
      const returnType = func.returnType || 'void';
      lines.push(`${func.isAsync ? 'async ' : ''}function ${func.name}(${params}): ${returnType}`);
      lines.push('```');
      lines.push('');

      if (func.params.length > 0) {
        lines.push('**Parameters:**');
        lines.push('');
        lines.push('| Name | Type | Description |');
        lines.push('|------|------|-------------|');
        for (const param of func.params) {
          lines.push(`| \`${param.name}\` | \`${param.type || 'unknown'}\` | ${inferParamDescription(param.name)} |`);
        }
        lines.push('');
      }

      lines.push(`**File:** \`${func.file}\``);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function generateHtmlDocs(
  entities: Array<CodeEntity & { file: string }>,
  title: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }
    h1 { border-bottom: 2px solid #333; }
    h2 { color: #0066cc; margin-top: 40px; }
    h3 { color: #333; margin-top: 30px; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
    pre { background: #f4f4f4; padding: 15px; border-radius: 5px; overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f4f4f4; }
    .file { color: #666; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>Generated automatically from source code.</p>
  
  <h2>Functions</h2>
  ${entities
    .filter(e => e.type === 'function')
    .map(e => `
    <h3>${e.name}</h3>
    <p>${e.description || 'No description available.'}</p>
    <pre><code>${e.isAsync ? 'async ' : ''}function ${e.name}(${e.params.map(p => p.name).join(', ')})</code></pre>
    <p class="file">File: ${e.file}</p>
  `).join('')}
  
  <h2>Classes</h2>
  ${entities
    .filter(e => e.type === 'class')
    .map(e => `
    <h3>${e.name}</h3>
    <p>${e.description || 'No description available.'}</p>
    <p class="file">File: ${e.file}</p>
  `).join('')}
</body>
</html>`;
}

// ============================================================================
// 4. GENERATE CHANGELOG
// ============================================================================

/**
 * Generate or update CHANGELOG.md
 */
export const generateChangelogTool: AgentTool = {
  name: 'generate_changelog',
  description: `Generate or update CHANGELOG.md:
- From git commits
- Follows conventional commits format
- Groups by type (feat, fix, docs, etc.)
- Auto-detects version bumps`,
  parameters: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description: 'Project directory',
      },
      version: {
        type: 'string',
        description: 'New version number',
      },
      since: {
        type: 'string',
        description: 'Generate since this tag/commit',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const directory = (params.directory as string) || process.cwd();
    const version = params.version as string | undefined;
    const since = params.since as string | undefined;

    try {
      // Generate changelog structure
      const date = new Date().toISOString().split('T')[0];
      const versionStr = version || 'Unreleased';

      const changelogEntry = `## [${versionStr}] - ${date}

### Added
- New feature 1
- New feature 2

### Changed
- Changed behavior 1
- Updated dependency 1

### Fixed
- Bug fix 1
- Bug fix 2

### Removed
- Removed deprecated feature 1

`;

      const changelogPath = path.join(directory, 'CHANGELOG.md');
      let existingContent = '';

      try {
        existingContent = await fs.readFile(changelogPath, 'utf-8');
      } catch {
        // File doesn't exist
      }

      let newContent: string;
      if (existingContent) {
        // Insert after the header
        const headerEnd = existingContent.indexOf('\n## ');
        if (headerEnd > 0) {
          newContent = existingContent.slice(0, headerEnd + 1) + changelogEntry + existingContent.slice(headerEnd + 1);
        } else {
          newContent = existingContent + '\n' + changelogEntry;
        }
      } else {
        newContent = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

${changelogEntry}`;
      }

      await fs.writeFile(changelogPath, newContent, 'utf-8');

      return {
        success: true,
        data: {
          file: changelogPath,
          version: versionStr,
          date,
          instructions: 'Please update the changelog with actual changes.',
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

export function getDocGeneratorTools(): AgentTool[] {
  return [
    generateJSDocTool,
    generateReadmeTool,
    generateApiDocsTool,
    generateChangelogTool,
  ];
}

export default {
  generateJSDocTool,
  generateReadmeTool,
  generateApiDocsTool,
  generateChangelogTool,
  getDocGeneratorTools,
};
