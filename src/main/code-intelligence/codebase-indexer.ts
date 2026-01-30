/**
 * Atlas Desktop - Codebase Indexer
 *
 * Indexes all symbols, imports, exports, and references in the codebase.
 * Enables fast symbol lookup, go-to-definition, and find-references
 * without re-parsing files.
 *
 * @module code-intelligence/codebase-indexer
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import * as ts from 'typescript';
import { EventEmitter } from 'events';
import { glob } from 'glob';
import { createModuleLogger } from '../utils/logger';
import {
  CodebaseIndex,
  CodeSymbol,
  SymbolKind,
  ImportInfo,
  ExportInfo,
  SymbolReference,
  IndexedFile,
  IndexStats,
  CodeIntelligenceConfig,
  DEFAULT_CODE_INTELLIGENCE_CONFIG,
} from './types';

const logger = createModuleLogger('CodebaseIndexer');

// =============================================================================
// Constants
// =============================================================================

const INDEX_VERSION = '1.0.0';

/**
 * Get modifiers from a node
 */
function getModifiers(node: ts.Node): string[] {
  const modifiers: string[] = [];

  if (ts.canHaveModifiers(node)) {
    const mods = ts.getModifiers(node);
    if (mods) {
      for (const mod of mods) {
        switch (mod.kind) {
          case ts.SyntaxKind.AsyncKeyword:
            modifiers.push('async');
            break;
          case ts.SyntaxKind.StaticKeyword:
            modifiers.push('static');
            break;
          case ts.SyntaxKind.PrivateKeyword:
            modifiers.push('private');
            break;
          case ts.SyntaxKind.ProtectedKeyword:
            modifiers.push('protected');
            break;
          case ts.SyntaxKind.PublicKeyword:
            modifiers.push('public');
            break;
          case ts.SyntaxKind.ReadonlyKeyword:
            modifiers.push('readonly');
            break;
          case ts.SyntaxKind.AbstractKeyword:
            modifiers.push('abstract');
            break;
          case ts.SyntaxKind.ExportKeyword:
            modifiers.push('export');
            break;
          case ts.SyntaxKind.DefaultKeyword:
            modifiers.push('default');
            break;
        }
      }
    }
  }

  return modifiers;
}

/**
 * Check if a node has export modifier
 */
function isExported(node: ts.Node): boolean {
  if (ts.canHaveModifiers(node)) {
    const mods = ts.getModifiers(node);
    if (mods) {
      return mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    }
  }
  return false;
}

/**
 * Check if a node has default export
 */
function isDefaultExport(node: ts.Node): boolean {
  if (ts.canHaveModifiers(node)) {
    const mods = ts.getModifiers(node);
    if (mods) {
      return mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    }
  }
  return false;
}

/**
 * Get JSDoc comment for a node
 */
function getJSDocComment(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  // Use getJSDocCommentsAndTags for proper JSDoc extraction
  const jsDocs = ts.getJSDocCommentsAndTags(node);
  if (jsDocs && jsDocs.length > 0) {
    return jsDocs.map((doc: ts.Node) => doc.getText(sourceFile)).join('\n');
  }
  return undefined;
}

// =============================================================================
// Codebase Indexer Class
// =============================================================================

/**
 * Indexes a codebase for fast symbol lookup and navigation.
 *
 * @example
 * ```typescript
 * const indexer = new CodebaseIndexer({
 *   workspaceRoot: '/path/to/project',
 * });
 *
 * await indexer.buildIndex();
 *
 * // Find a symbol
 * const symbols = indexer.findSymbol('VoicePipeline');
 *
 * // Get references
 * const refs = indexer.findReferences('VoicePipeline');
 * ```
 */
export class CodebaseIndexer extends EventEmitter {
  private config: CodeIntelligenceConfig;
  private index: CodebaseIndex | null = null;
  private isIndexing = false;

  constructor(config: Partial<CodeIntelligenceConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CODE_INTELLIGENCE_CONFIG, ...config };
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Build or rebuild the complete index
   */
  async buildIndex(): Promise<CodebaseIndex> {
    if (this.isIndexing) {
      logger.warn('Index build already in progress');
      throw new Error('Index build already in progress');
    }

    this.isIndexing = true;
    const startTime = Date.now();

    try {
      logger.info('Building codebase index', { root: this.config.workspaceRoot });

      // Find all files to index
      const files = await this.findFiles();
      logger.info(`Found ${files.length} files to index`);

      // Initialize empty index
      this.index = {
        workspaceRoot: this.config.workspaceRoot,
        lastUpdated: Date.now(),
        version: INDEX_VERSION,
        files: new Map(),
        symbols: new Map(),
        symbolNameIndex: new Map(),
        imports: [],
        exports: [],
        references: new Map(),
        stats: {
          totalFiles: 0,
          totalSymbols: 0,
          totalImports: 0,
          totalExports: 0,
          totalReferences: 0,
          indexTimeMs: 0,
          filesWithErrors: 0,
        },
      };

      // Index each file
      let filesWithErrors = 0;
      for (const filePath of files) {
        try {
          await this.indexFile(filePath);
        } catch (error) {
          filesWithErrors++;
          logger.warn(`Failed to index file: ${filePath}`, { error });
        }
      }

      // Update stats
      const elapsed = Date.now() - startTime;
      this.index.stats = {
        totalFiles: this.index.files.size,
        totalSymbols: this.index.symbols.size,
        totalImports: this.index.imports.length,
        totalExports: this.index.exports.length,
        totalReferences: Array.from(this.index.references.values()).reduce(
          (sum, refs) => sum + refs.length,
          0
        ),
        indexTimeMs: elapsed,
        filesWithErrors,
      };

      logger.info('Index build complete', { ...this.index.stats });
      this.emit('index-complete', this.index.stats);

      return this.index;
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Update index for a single file
   */
  async updateFile(filePath: string): Promise<void> {
    if (!this.index) {
      await this.buildIndex();
      return;
    }

    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.config.workspaceRoot, filePath);

    // Check if file exists
    try {
      await fs.access(absolutePath);
    } catch {
      // File was deleted, remove from index
      this.removeFileFromIndex(absolutePath);
      return;
    }

    // Re-index the file
    await this.indexFile(absolutePath);
    this.index.lastUpdated = Date.now();

    this.emit('file-updated', filePath);
  }

  /**
   * Find symbols by name
   */
  findSymbol(name: string, kind?: SymbolKind): CodeSymbol[] {
    if (!this.index) {
      return [];
    }

    // Check exact match in name index
    const qualifiedNames = this.index.symbolNameIndex.get(name) || [];
    let symbols = qualifiedNames
      .map((qn) => this.index!.symbols.get(qn))
      .filter((s): s is CodeSymbol => s !== undefined);

    // Also search for partial matches
    if (symbols.length === 0) {
      const lowerName = name.toLowerCase();
      for (const [, symbol] of this.index.symbols) {
        if (symbol.name.toLowerCase().includes(lowerName)) {
          symbols.push(symbol);
        }
      }
    }

    // Filter by kind if specified
    if (kind) {
      symbols = symbols.filter((s) => s.kind === kind);
    }

    return symbols;
  }

  /**
   * Find all references to a symbol
   */
  findReferences(symbolName: string): SymbolReference[] {
    if (!this.index) {
      return [];
    }

    // First find the symbol
    const symbols = this.findSymbol(symbolName);
    if (symbols.length === 0) {
      return [];
    }

    // Get references for each matching symbol
    const allRefs: SymbolReference[] = [];
    for (const symbol of symbols) {
      const refs = this.index.references.get(symbol.qualifiedName) || [];
      allRefs.push(...refs);
    }

    return allRefs;
  }

  /**
   * Go to definition of a symbol
   */
  goToDefinition(
    symbolName: string
  ): { filePath: string; line: number; column: number } | null {
    const symbols = this.findSymbol(symbolName);
    if (symbols.length === 0) {
      return null;
    }

    // Return the first (most relevant) match
    const symbol = symbols[0];
    return {
      filePath: symbol.filePath,
      line: symbol.line,
      column: symbol.column,
    };
  }

  /**
   * Get all files that import from a given file
   */
  getImporters(filePath: string): string[] {
    if (!this.index) {
      return [];
    }

    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.config.workspaceRoot, filePath);

    const fileInfo = this.index.files.get(absolutePath);
    return fileInfo?.importedBy || [];
  }

  /**
   * Get all files that a given file imports
   */
  getImports(filePath: string): string[] {
    if (!this.index) {
      return [];
    }

    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.config.workspaceRoot, filePath);

    const fileInfo = this.index.files.get(absolutePath);
    return fileInfo?.imports || [];
  }

  /**
   * Get all symbols in a file
   */
  getFileSymbols(filePath: string): CodeSymbol[] {
    if (!this.index) {
      return [];
    }

    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.config.workspaceRoot, filePath);

    const fileInfo = this.index.files.get(absolutePath);
    if (!fileInfo) {
      return [];
    }

    return fileInfo.symbols
      .map((qn) => this.index!.symbols.get(qn))
      .filter((s): s is CodeSymbol => s !== undefined);
  }

  /**
   * Get index statistics
   */
  getStats(): IndexStats | null {
    return this.index?.stats || null;
  }

  /**
   * Check if index is ready
   */
  isReady(): boolean {
    return this.index !== null && !this.isIndexing;
  }

  /**
   * Get the full index (for serialization)
   */
  getIndex(): CodebaseIndex | null {
    return this.index;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Find all files to index
   */
  private async findFiles(): Promise<string[]> {
    const files: string[] = [];

    for (const pattern of this.config.includePatterns) {
      const matches = await glob(pattern, {
        cwd: this.config.workspaceRoot,
        ignore: this.config.excludePatterns,
        absolute: true,
        nodir: true,
      });
      files.push(...matches);
    }

    // Limit number of files
    if (files.length > this.config.maxFiles) {
      logger.warn(
        `Found ${files.length} files, limiting to ${this.config.maxFiles}`
      );
      return files.slice(0, this.config.maxFiles);
    }

    return files;
  }

  /**
   * Index a single file
   */
  private async indexFile(filePath: string): Promise<void> {
    const content = await fs.readFile(filePath, 'utf-8');

    // Check file size
    if (content.length > this.config.maxFileSize) {
      logger.debug(`Skipping large file: ${filePath}`);
      return;
    }

    // Calculate content hash
    const contentHash = createHash('md5').update(content).digest('hex');

    // Check if file changed
    const existingFile = this.index!.files.get(filePath);
    if (existingFile && existingFile.contentHash === contentHash) {
      return; // File unchanged
    }

    // Remove old data if updating
    if (existingFile) {
      this.removeFileFromIndex(filePath);
    }

    // Parse with TypeScript
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
        ? ts.ScriptKind.TSX
        : ts.ScriptKind.TS
    );

    // Extract symbols
    const symbols: CodeSymbol[] = [];
    const imports: ImportInfo[] = [];
    const exports: ExportInfo[] = [];
    const errors: string[] = [];

    const visit = (node: ts.Node, parentName?: string) => {
      try {
        // Handle imports
        if (ts.isImportDeclaration(node)) {
          const importInfo = this.extractImport(node, sourceFile, filePath);
          if (importInfo) {
            imports.push(importInfo);
            this.index!.imports.push(importInfo);
          }
        }

        // Handle exports
        if (ts.isExportDeclaration(node)) {
          const exportInfos = this.extractExport(node, sourceFile, filePath);
          exports.push(...exportInfos);
          this.index!.exports.push(...exportInfos);
        }

        // Handle symbol declarations
        const symbol = this.extractSymbol(node, sourceFile, filePath, parentName);
        if (symbol) {
          symbols.push(symbol);
          this.index!.symbols.set(symbol.qualifiedName, symbol);

          // Update name index
          const existing = this.index!.symbolNameIndex.get(symbol.name) || [];
          existing.push(symbol.qualifiedName);
          this.index!.symbolNameIndex.set(symbol.name, existing);

          // Visit children with parent context
          if (
            ts.isClassDeclaration(node) ||
            ts.isInterfaceDeclaration(node) ||
            ts.isModuleDeclaration(node)
          ) {
            ts.forEachChild(node, (child) => visit(child, symbol.qualifiedName));
            return;
          }
        }

        // Continue visiting
        ts.forEachChild(node, (child) => visit(child, parentName));
      } catch (error) {
        errors.push(`Error processing node: ${error}`);
      }
    };

    ts.forEachChild(sourceFile, (node) => visit(node));

    // Get file stats
    const stats = await fs.stat(filePath);
    const relativePath = path.relative(this.config.workspaceRoot, filePath);

    // Create indexed file entry
    const indexedFile: IndexedFile = {
      path: filePath,
      relativePath,
      extension: path.extname(filePath),
      lastModified: stats.mtimeMs,
      contentHash,
      lineCount: content.split('\n').length,
      symbols: symbols.map((s) => s.qualifiedName),
      imports: imports
        .map((i) => i.resolvedPath)
        .filter((p): p is string => p !== undefined),
      importedBy: existingFile?.importedBy || [],
      hasErrors: errors.length > 0,
      errors: errors.length > 0 ? errors : undefined,
    };

    this.index!.files.set(filePath, indexedFile);

    // Update importedBy for imported files
    for (const imp of imports) {
      if (imp.resolvedPath) {
        const importedFile = this.index!.files.get(imp.resolvedPath);
        if (importedFile && !importedFile.importedBy.includes(filePath)) {
          importedFile.importedBy.push(filePath);
        }
      }
    }
  }

  /**
   * Extract import information from an import declaration
   */
  private extractImport(
    node: ts.ImportDeclaration,
    _sourceFile: ts.SourceFile,
    filePath: string
  ): ImportInfo | null {
    const moduleSpecifier = node.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) {
      return null;
    }

    const info: ImportInfo = {
      filePath,
      moduleSpecifier: moduleSpecifier.text,
      isTypeOnly: node.importClause?.isTypeOnly || false,
      namedImports: [],
    };

    // Resolve local imports
    if (
      moduleSpecifier.text.startsWith('.') ||
      moduleSpecifier.text.startsWith('/')
    ) {
      const resolved = this.resolveImportPath(
        moduleSpecifier.text,
        path.dirname(filePath)
      );
      if (resolved) {
        info.resolvedPath = resolved;
      }
    }

    // Extract import clause
    const clause = node.importClause;
    if (clause) {
      // Default import
      if (clause.name) {
        info.defaultImport = clause.name.text;
      }

      // Named/namespace imports
      const bindings = clause.namedBindings;
      if (bindings) {
        if (ts.isNamespaceImport(bindings)) {
          info.namespaceImport = bindings.name.text;
        } else if (ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            info.namedImports.push({
              name: element.name.text,
              alias: element.propertyName?.text,
              isType: element.isTypeOnly,
            });
          }
        }
      }
    }

    return info;
  }

  /**
   * Extract export information from an export declaration
   */
  private extractExport(
    node: ts.ExportDeclaration,
    _sourceFile: ts.SourceFile,
    filePath: string
  ): ExportInfo[] {
    const exports: ExportInfo[] = [];

    // Re-export from another module
    const moduleSpecifier = node.moduleSpecifier;
    const isReExport = moduleSpecifier !== undefined;
    const sourceModule = moduleSpecifier && ts.isStringLiteral(moduleSpecifier)
      ? moduleSpecifier.text
      : undefined;

    // Named exports
    const exportClause = node.exportClause;
    if (exportClause && ts.isNamedExports(exportClause)) {
      for (const element of exportClause.elements) {
        exports.push({
          filePath,
          name: element.name.text,
          localName: element.propertyName?.text,
          isTypeOnly: node.isTypeOnly || false,
          isReExport,
          sourceModule,
        });
      }
    }

    return exports;
  }

  /**
   * Extract symbol from a declaration node
   */
  private extractSymbol(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    filePath: string,
    parentName?: string
  ): CodeSymbol | null {
    let name: string | undefined;
    let kind: SymbolKind;
    let signature: string | undefined;

    // Get name and kind based on node type
    if (ts.isClassDeclaration(node) && node.name) {
      name = node.name.text;
      kind = 'class';
    } else if (ts.isInterfaceDeclaration(node)) {
      name = node.name.text;
      kind = 'interface';
    } else if (ts.isTypeAliasDeclaration(node)) {
      name = node.name.text;
      kind = 'type';
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      name = node.name.text;
      kind = 'function';
      signature = this.getFunctionSignature(node);
    } else if (ts.isMethodDeclaration(node) && node.name) {
      name = ts.isIdentifier(node.name) ? node.name.text : undefined;
      kind = 'method';
      signature = this.getFunctionSignature(node);
    } else if (ts.isPropertyDeclaration(node) && node.name) {
      name = ts.isIdentifier(node.name) ? node.name.text : undefined;
      kind = 'property';
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      name = node.name.text;
      // Check if it's a constant
      const varStatement = node.parent?.parent;
      if (
        varStatement &&
        ts.isVariableStatement(varStatement) &&
        varStatement.declarationList.flags & ts.NodeFlags.Const
      ) {
        kind = 'constant';
      } else {
        kind = 'variable';
      }
    } else if (ts.isEnumDeclaration(node)) {
      name = node.name.text;
      kind = 'enum';
    } else if (ts.isEnumMember(node) && ts.isIdentifier(node.name)) {
      name = node.name.text;
      kind = 'enumMember';
    } else if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) {
      name = node.name.text;
      kind = 'namespace';
    } else {
      return null;
    }

    if (!name) {
      return null;
    }

    // Get position
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile)
    );
    const endPos = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

    // Build qualified name
    const qualifiedName = parentName ? `${parentName}.${name}` : name;

    return {
      name,
      qualifiedName,
      kind,
      filePath,
      line: line + 1,
      column: character + 1,
      endLine: endPos.line + 1,
      endColumn: endPos.character + 1,
      documentation: getJSDocComment(node, sourceFile),
      signature,
      isExported: isExported(node),
      isDefaultExport: isDefaultExport(node),
      parent: parentName,
      modifiers: getModifiers(node),
    };
  }

  /**
   * Get function signature string
   */
  private getFunctionSignature(
    node: ts.FunctionDeclaration | ts.MethodDeclaration
  ): string {
    const params = node.parameters.map((p) => {
      const name = ts.isIdentifier(p.name) ? p.name.text : '?';
      const type = p.type ? `: ${p.type.getText()}` : '';
      const optional = p.questionToken ? '?' : '';
      return `${name}${optional}${type}`;
    });

    const returnType = node.type ? `: ${node.type.getText()}` : '';
    return `(${params.join(', ')})${returnType}`;
  }

  /**
   * Resolve import path to absolute file path
   */
  private resolveImportPath(
    importPath: string,
    fromDir: string
  ): string | undefined {
    // Try direct path
    const extensions = ['.ts', '.tsx', '.js', '.jsx', ''];

    for (const ext of extensions) {
      const fullPath = path.resolve(fromDir, importPath + ext);
      try {
        // Check sync since we're in a tight loop
        require('fs').accessSync(fullPath);
        return fullPath;
      } catch {
        // Try index file
        const indexPath = path.resolve(fromDir, importPath, 'index' + ext);
        try {
          require('fs').accessSync(indexPath);
          return indexPath;
        } catch {
          continue;
        }
      }
    }

    return undefined;
  }

  /**
   * Remove a file from the index
   */
  private removeFileFromIndex(filePath: string): void {
    if (!this.index) return;

    const fileInfo = this.index.files.get(filePath);
    if (!fileInfo) return;

    // Remove symbols
    for (const symbolName of fileInfo.symbols) {
      this.index.symbols.delete(symbolName);

      // Update name index
      const symbol = this.index.symbols.get(symbolName);
      if (symbol) {
        const names = this.index.symbolNameIndex.get(symbol.name);
        if (names) {
          const idx = names.indexOf(symbolName);
          if (idx >= 0) names.splice(idx, 1);
        }
      }
    }

    // Remove imports
    this.index.imports = this.index.imports.filter(
      (i) => i.filePath !== filePath
    );

    // Remove exports
    this.index.exports = this.index.exports.filter(
      (e) => e.filePath !== filePath
    );

    // Update importedBy for files this file imported
    for (const importedPath of fileInfo.imports) {
      const importedFile = this.index.files.get(importedPath);
      if (importedFile) {
        const idx = importedFile.importedBy.indexOf(filePath);
        if (idx >= 0) importedFile.importedBy.splice(idx, 1);
      }
    }

    // Remove file entry
    this.index.files.delete(filePath);
  }
}

// =============================================================================
// Singleton
// =============================================================================

let indexerInstance: CodebaseIndexer | null = null;

/**
 * Get the codebase indexer singleton
 */
export function getCodebaseIndexer(
  config?: Partial<CodeIntelligenceConfig>
): CodebaseIndexer {
  if (!indexerInstance) {
    indexerInstance = new CodebaseIndexer(config);
  }
  return indexerInstance;
}

/**
 * Reset the indexer (for testing)
 */
export function resetCodebaseIndexer(): void {
  indexerInstance = null;
}
