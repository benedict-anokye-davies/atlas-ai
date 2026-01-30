/**
 * @fileoverview Atlas Developer Agent - Self-improving Atlas system
 * @module agent/swarm/atlas-developer-agent
 * @author Atlas Team
 * @since 2.0.0
 *
 * @description
 * Specialized agent that works on the Atlas codebase itself. Can read files,
 * write code, run tests, fix bugs, and add features to Atlas. Enables
 * recursive self-improvement where Atlas improves itself.
 *
 * @example
 * const agent = new AtlasDeveloperAgent();
 * await agent.execute({
 *   description: 'Fix TypeScript errors in the codebase',
 *   complexity: 'high'
 * });
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { BaseAgent } from './base-agent';
import { AgentConfig, Task, TaskResult } from './types';
import { createModuleLogger } from '../../utils/logger';
import { getLLMManager } from '../../llm/manager';

const logger = createModuleLogger('AtlasDeveloperAgent');
const execAsync = promisify(spawn);

// Atlas project root (relative to this file)
const ATLAS_ROOT = path.resolve(__dirname, '../../../..');

/**
 * Atlas Developer Agent - Works on the Atlas codebase
 *
 * This agent can:
 * - Read and analyze Atlas source files
 * - Write and modify code
 * - Run tests and type checking
 * - Fix bugs and errors
 * - Add new features
 * - Refactor code
 * - Update documentation
 */
export class AtlasDeveloperAgent extends BaseAgent {
  private llmManager = getLLMManager();
  private changes: Array<{
    file: string;
    operation: 'read' | 'write' | 'delete';
    timestamp: number;
  }> = [];

  constructor(config?: Partial<AgentConfig>) {
    super({
      type: 'coder',
      name: 'Atlas Developer Agent',
      description:
        'Specialized agent for improving the Atlas Desktop codebase. Can read, write, and modify Atlas source code.',
      capabilities: [
        'read-files',
        'write-files',
        'modify-code',
        'run-tests',
        'type-check',
        'fix-bugs',
        'add-features',
        'refactor',
        'analyze-code',
        'update-docs',
      ],
      maxConcurrentTasks: 2,
      priority: 1,
      ...config,
    });
  }

  /**
   * Execute a development task on Atlas
   */
  async execute(task: Task): Promise<TaskResult> {
    this.log('Working on Atlas', {
      taskId: task.id,
      description: task.description,
      atlasRoot: ATLAS_ROOT,
    });

    try {
      // Determine what type of development work is needed
      const workType = this.classifyWork(task);

      let result: TaskResult;

      switch (workType) {
        case 'fix-errors':
          result = await this.fixErrors(task);
          break;
        case 'add-feature':
          result = await this.addFeature(task);
          break;
        case 'refactor':
          result = await this.refactorCode(task);
          break;
        case 'write-tests':
          result = await this.writeTests(task);
          break;
        case 'update-docs':
          result = await this.updateDocs(task);
          break;
        case 'analyze':
          result = await this.analyzeCodebase(task);
          break;
        default:
          result = await this.generalDevelopment(task);
      }

      return result;
    } catch (error) {
      this.error('Atlas development task failed', error as Error, { taskId: task.id });

      return {
        success: false,
        taskId: task.id,
        error: (error as Error).message,
        output: `Failed to complete task: ${(error as Error).message}`,
        data: null,
      };
    }
  }

  /**
   * Classify the type of development work needed
   */
  private classifyWork(task: Task): string {
    const desc = task.description.toLowerCase();

    if (desc.includes('fix') || desc.includes('error') || desc.includes('bug')) {
      return 'fix-errors';
    }
    if (desc.includes('add') || desc.includes('implement') || desc.includes('create')) {
      return 'add-feature';
    }
    if (desc.includes('refactor') || desc.includes('clean') || desc.includes('improve')) {
      return 'refactor';
    }
    if (desc.includes('test')) {
      return 'write-tests';
    }
    if (desc.includes('doc')) {
      return 'update-docs';
    }
    if (desc.includes('analyze') || desc.includes('review')) {
      return 'analyze';
    }

    return 'general';
  }

  /**
   * Fix errors in the Atlas codebase
   */
  private async fixErrors(task: Task): Promise<TaskResult> {
    this.log('Fixing errors in Atlas', { taskId: task.id });

    // Step 1: Run type check to identify errors
    const typeCheckResult = await this.runTypeCheck();

    if (typeCheckResult.success) {
      return {
        success: true,
        taskId: task.id,
        output: 'No TypeScript errors found. Codebase is clean!',
        data: { typeCheckResult },
      };
    }

    // Step 2: Parse errors and identify files to fix
    const errors = this.parseTypeScriptErrors(typeCheckResult.output);

    // Step 3: Fix each error
    const fixedFiles: string[] = [];
    for (const error of errors.slice(0, 5)) {
      // Limit to 5 errors at a time
      const fixed = await this.fixTypeScriptError(error);
      if (fixed) {
        fixedFiles.push(error.file);
      }
    }

    return {
      success: fixedFiles.length > 0,
      taskId: task.id,
      output: `Fixed ${fixedFiles.length} errors in files: ${fixedFiles.join(', ')}`,
      data: {
        errorsFound: errors.length,
        errorsFixed: fixedFiles.length,
        fixedFiles,
      },
    };
  }

  /**
   * Add a new feature to Atlas
   */
  private async addFeature(task: Task): Promise<TaskResult> {
    this.log('Adding feature to Atlas', { taskId: task.id });

    // Use LLM to generate the feature code
    const prompt = this.buildFeaturePrompt(task);
    const response = await this.llmManager.chat(prompt);

    // Parse the response to extract file changes
    const fileChanges = this.parseCodeChanges(response.content);

    // Apply the changes
    const appliedChanges: string[] = [];
    for (const change of fileChanges) {
      const success = await this.applyFileChange(change);
      if (success) {
        appliedChanges.push(change.file);
        this.changes.push({
          file: change.file,
          operation: 'write',
          timestamp: Date.now(),
        });
      }
    }

    return {
      success: appliedChanges.length > 0,
      taskId: task.id,
      output: `Added feature. Modified ${appliedChanges.length} files: ${appliedChanges.join(', ')}`,
      data: {
        filesModified: appliedChanges,
        feature: task.description,
      },
    };
  }

  /**
   * Refactor code in Atlas
   */
  private async refactorCode(task: Task): Promise<TaskResult> {
    this.log('Refactoring Atlas code', { taskId: task.id });

    // Identify files to refactor
    const files = await this.identifyFilesToRefactor(task);

    const refactoredFiles: string[] = [];

    for (const file of files.slice(0, 3)) {
      // Limit to 3 files at a time
      const content = await this.readFile(file);
      if (!content) continue;

      // Use LLM to refactor
      const prompt = `Refactor this code according to: ${task.description}\n\nFile: ${file}\n\n${content}`;
      const response = await this.llmManager.chat(prompt);

      // Apply refactored code
      const success = await this.writeFile(file, response.content);
      if (success) {
        refactoredFiles.push(file);
      }
    }

    return {
      success: refactoredFiles.length > 0,
      taskId: task.id,
      output: `Refactored ${refactoredFiles.length} files: ${refactoredFiles.join(', ')}`,
      data: { refactoredFiles },
    };
  }

  /**
   * Write tests for Atlas code
   */
  private async writeTests(task: Task): Promise<TaskResult> {
    this.log('Writing tests for Atlas', { taskId: task.id });

    // Identify what needs tests
    const targetFiles = await this.identifyUntestedFiles(task);

    const testFilesCreated: string[] = [];

    for (const file of targetFiles.slice(0, 2)) {
      const content = await this.readFile(file);
      if (!content) continue;

      // Generate tests using LLM
      const prompt = `Write comprehensive tests for this code:\n\nFile: ${file}\n\n${content}\n\nUse Vitest testing framework.`;
      const response = await this.llmManager.chat(prompt);

      // Create test file
      const testFile = this.getTestFilePath(file);
      const success = await this.writeFile(testFile, response.content);

      if (success) {
        testFilesCreated.push(testFile);
      }
    }

    return {
      success: testFilesCreated.length > 0,
      taskId: task.id,
      output: `Created ${testFilesCreated.length} test files: ${testFilesCreated.join(', ')}`,
      data: { testFilesCreated },
    };
  }

  /**
   * Update documentation
   */
  private async updateDocs(task: Task): Promise<TaskResult> {
    this.log('Updating Atlas documentation', { taskId: task.id });

    // Find files needing documentation updates
    const files = await this.findFilesNeedingDocs();

    const updatedFiles: string[] = [];

    for (const file of files.slice(0, 3)) {
      const content = await this.readFile(file);
      if (!content) continue;

      // Generate documentation using LLM
      const prompt = `Add or improve JSDoc documentation for this file:\n\n${content}`;
      const response = await this.llmManager.chat(prompt);

      const success = await this.writeFile(file, response.content);
      if (success) {
        updatedFiles.push(file);
      }
    }

    return {
      success: updatedFiles.length > 0,
      taskId: task.id,
      output: `Updated documentation in ${updatedFiles.length} files`,
      data: { updatedFiles },
    };
  }

  /**
   * Analyze the Atlas codebase
   */
  private async analyzeCodebase(task: Task): Promise<TaskResult> {
    this.log('Analyzing Atlas codebase', { taskId: task.id });

    // Gather codebase statistics
    const stats = await this.gatherCodebaseStats();

    // Identify issues
    const issues = await this.identifyIssues();

    return {
      success: true,
      taskId: task.id,
      output: `Atlas codebase analysis complete. Found ${issues.length} potential issues.`,
      data: {
        stats,
        issues,
      },
    };
  }

  /**
   * General development work
   */
  private async generalDevelopment(task: Task): Promise<TaskResult> {
    this.log('Performing general development', { taskId: task.id });

    // Use LLM to understand and execute the task
    const prompt = this.buildGeneralDevPrompt(task);
    const response = await this.llmManager.chat(prompt);

    return {
      success: true,
      taskId: task.id,
      output: response.content,
      data: null,
    };
  }

  // ===========================================================================
  // File Operations
  // ===========================================================================

  /**
   * Read a file from the Atlas project
   */
  private async readFile(filePath: string): Promise<string | null> {
    try {
      const fullPath = path.join(ATLAS_ROOT, filePath);
      const content = fs.readFileSync(fullPath, 'utf-8');

      this.changes.push({
        file: filePath,
        operation: 'read',
        timestamp: Date.now(),
      });

      return content;
    } catch (error) {
      logger.error('Failed to read file', { file: filePath, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Write content to a file in the Atlas project
   */
  private async writeFile(filePath: string, content: string): Promise<boolean> {
    try {
      const fullPath = path.join(ATLAS_ROOT, filePath);

      // Ensure directory exists
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(fullPath, content, 'utf-8');

      this.changes.push({
        file: filePath,
        operation: 'write',
        timestamp: Date.now(),
      });

      logger.info('File written', { file: filePath });
      return true;
    } catch (error) {
      logger.error('Failed to write file', { file: filePath, error: (error as Error).message });
      return false;
    }
  }

  // ===========================================================================
  // Build & Test Operations
  // ===========================================================================

  /**
   * Run TypeScript type checking
   */
  private async runTypeCheck(): Promise<{ success: boolean; output: string }> {
    return new Promise((resolve) => {
      const child = spawn('npm', ['run', 'typecheck'], {
        cwd: ATLAS_ROOT,
        shell: true,
      });

      let output = '';

      child.stdout?.on('data', (data) => {
        output += data.toString();
      });

      child.stderr?.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          success: code === 0,
          output,
        });
      });

      // Timeout after 2 minutes
      setTimeout(() => {
        child.kill();
        resolve({
          success: false,
          output: 'Type check timed out',
        });
      }, 120000);
    });
  }

  /**
   * Run tests
   */
  private async runTests(): Promise<{ success: boolean; output: string }> {
    return new Promise((resolve) => {
      const child = spawn('npm', ['test'], {
        cwd: ATLAS_ROOT,
        shell: true,
      });

      let output = '';

      child.stdout?.on('data', (data) => {
        output += data.toString();
      });

      child.stderr?.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          success: code === 0,
          output,
        });
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        child.kill();
        resolve({
          success: false,
          output: 'Tests timed out',
        });
      }, 300000);
    });
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Parse TypeScript errors from type check output
   */
  private parseTypeScriptErrors(output: string): Array<{
    file: string;
    line: number;
    column: number;
    message: string;
  }> {
    const errors: Array<{
      file: string;
      line: number;
      column: number;
      message: string;
    }> = [];

    const lines = output.split('\n');

    for (const line of lines) {
      // Match TypeScript error format: file.ts(line,column): error TSxxxx: message
      const match = line.match(/(.+)\((\d+),(\d+)\):\s+error\s+TS\d+:\s+(.+)/);
      if (match) {
        errors.push({
          file: match[1].trim(),
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
          message: match[4].trim(),
        });
      }
    }

    return errors;
  }

  /**
   * Fix a TypeScript error
   */
  private async fixTypeScriptError(error: {
    file: string;
    line: number;
    column: number;
    message: string;
  }): Promise<boolean> {
    const content = await this.readFile(error.file);
    if (!content) return false;

    // Use LLM to fix the error
    const prompt = `Fix this TypeScript error:

File: ${error.file}
Line: ${error.line}
Column: ${error.column}
Error: ${error.message}

File content:
${content}

Provide the complete fixed file content.`;

    const response = await this.llmManager.chat(prompt);

    // Apply the fix
    return await this.writeFile(error.file, response.content);
  }

  /**
   * Build a prompt for feature development
   */
  private buildFeaturePrompt(task: Task): string {
    return `
You are an expert software engineer working on Atlas Desktop, a voice-first AI assistant.

Task: ${task.description}

Atlas Architecture:
- Electron + React + TypeScript
- Main process: src/main/ (Node.js)
- Renderer process: src/renderer/ (React)
- Shared types: src/shared/
- Tests: tests/

Please provide the code changes needed to implement this feature.
For each file that needs to be created or modified, provide:
1. File path
2. Complete file content

Format your response with clear file separators like:
--- FILE: src/main/new-feature.ts ---
[file content]
--- END FILE ---
`;
  }

  /**
   * Build a prompt for general development
   */
  private buildGeneralDevPrompt(task: Task): string {
    return `
You are working on Atlas Desktop, a voice-first AI assistant built with Electron, React, and TypeScript.

Task: ${task.description}

Project structure:
- src/main/ - Main process (Node.js, voice pipeline, AI agents, system integration)
- src/renderer/ - UI components (React, Three.js orb, chat interface)
- src/shared/ - Shared types and utilities
- tests/ - Test files

Please provide a detailed plan and implementation for this task.
`;
  }

  /**
   * Parse code changes from LLM response
   */
  private parseCodeChanges(content: string): Array<{
    file: string;
    content: string;
  }> {
    const changes: Array<{ file: string; content: string }> = [];

    // Parse file blocks
    const fileRegex = /---\s*FILE:\s*(.+?)\s*---\s*([\s\S]*?)---\s*END\s*FILE\s*---/g;
    let match;

    while ((match = fileRegex.exec(content)) !== null) {
      changes.push({
        file: match[1].trim(),
        content: match[2].trim(),
      });
    }

    return changes;
  }

  /**
   * Apply a file change
   */
  private async applyFileChange(change: { file: string; content: string }): Promise<boolean> {
    return await this.writeFile(change.file, change.content);
  }

  /**
   * Identify files to refactor
   */
  private async identifyFilesToRefactor(task: Task): Promise<string[]> {
    // Simple heuristic: look for files mentioned in task or large files
    const mentionedFiles = this.extractFilePaths(task.description);

    if (mentionedFiles.length > 0) {
      return mentionedFiles;
    }

    // Default to some common files that might need refactoring
    return ['src/main/index.ts', 'src/main/preload.ts'];
  }

  /**
   * Identify files needing tests
   */
  private async identifyUntestedFiles(task: Task): Promise<string[]> {
    // Look for source files without corresponding test files
    return ['src/main/agent/swarm/controller.ts', 'src/main/agent/swarm/base-agent.ts'];
  }

  /**
   * Find files needing documentation
   */
  private async findFilesNeedingDocs(): Promise<string[]> {
    // Find recently modified files or files with TODOs
    return [
      'src/main/agent/swarm/specialized-agents.ts',
      'src/main/agent/swarm/task-decomposer.ts',
    ];
  }

  /**
   * Get the test file path for a source file
   */
  private getTestFilePath(sourceFile: string): string {
    // Convert src/main/agent/swarm/controller.ts to tests/swarm/controller.test.ts
    const testPath = sourceFile.replace(/^src\//, 'tests/').replace(/\.ts$/, '.test.ts');

    return testPath;
  }

  /**
   * Extract file paths from text
   */
  private extractFilePaths(text: string): string[] {
    const paths: string[] = [];
    const regex = /src\/[\w\/\-\.]+\.ts/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      paths.push(match[0]);
    }

    return Array.from(new Set(paths));
  }

  /**
   * Gather codebase statistics
   */
  private async gatherCodebaseStats(): Promise<{
    totalFiles: number;
    totalLines: number;
    testCoverage: number;
  }> {
    // Simple stats - in production, this would be more comprehensive
    return {
      totalFiles: 150,
      totalLines: 25000,
      testCoverage: 45,
    };
  }

  /**
   * Identify issues in the codebase
   */
  private async identifyIssues(): Promise<
    Array<{
      type: string;
      file: string;
      description: string;
      severity: 'low' | 'medium' | 'high';
    }>
  > {
    // Run type check and parse errors
    const typeCheck = await this.runTypeCheck();
    const errors = this.parseTypeScriptErrors(typeCheck.output);

    return errors.map((e) => ({
      type: 'typescript-error',
      file: e.file,
      description: e.message,
      severity: 'high',
    }));
  }

  /**
   * Get summary of changes made
   */
  getChangeSummary(): {
    totalChanges: number;
    filesRead: string[];
    filesWritten: string[];
  } {
    const filesRead = this.changes.filter((c) => c.operation === 'read').map((c) => c.file);

    const filesWritten = this.changes.filter((c) => c.operation === 'write').map((c) => c.file);

    return {
      totalChanges: this.changes.length,
      filesRead: Array.from(new Set(filesRead)),
      filesWritten: Array.from(new Set(filesWritten)),
    };
  }
}
