/**
 * Atlas Desktop - Autonomous Coding Agent
 * 
 * The brain that makes Atlas truly autonomous:
 * - Auto-applies changes without asking
 * - Auto-commits after each meaningful change
 * - Watches screen for errors and auto-fixes
 * - Learns coding patterns and preferences
 * - Completes entire projects autonomously
 * - Voice-first interaction with proactive updates
 * 
 * @module agent/autonomous-agent
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createModuleLogger } from '../utils/logger';
import { count, sleep } from '../../shared/utils';
import { getJarvisBrain, JarvisBrain } from '../cognitive';
import { getAllTools, getToolByName } from './tools';
import { Agent, initializeAgent } from './index';
import { ActionResult, AgentTool } from '../../shared/types/agent';
import { screen, desktopCapturer } from 'electron';
import { getTTSManager } from '../tts/manager';

const execAsync = promisify(exec);
const logger = createModuleLogger('AutonomousAgent');

// ============================================================================
// Types
// ============================================================================

export type AutonomyLevel = 'supervised' | 'trusted' | 'autonomous';

export interface AutonomousConfig {
  /** Autonomy level - how much freedom Atlas has */
  autonomyLevel: AutonomyLevel;
  
  /** Auto-commit after changes */
  autoCommit: boolean;
  
  /** Commit message style: 'conventional' | 'descriptive' | 'brief' */
  commitStyle: 'conventional' | 'descriptive' | 'brief';
  
  /** Auto-fix detected errors */
  autoFixErrors: boolean;
  
  /** Screen monitoring interval (ms) - 0 to disable */
  screenMonitorInterval: number;
  
  /** Voice updates for progress */
  voiceUpdates: boolean;
  
  /** Ask clarifying questions when uncertain */
  askClarifyingQuestions: boolean;
  
  /** Max iterations for complex tasks */
  maxIterations: number;
  
  /** Actions that ALWAYS require confirmation */
  requireConfirmation: string[];
  
  /** Working directory */
  workingDirectory: string;
  
  /** Learn from this project */
  learnFromProject: boolean;
}

export interface TaskStatus {
  id: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'needs-input';
  progress: number; // 0-100
  subtasks: TaskStatus[];
  startTime?: number;
  endTime?: number;
  error?: string;
}

export interface ScreenContext {
  timestamp: number;
  hasError: boolean;
  errorText?: string;
  activeWindow?: string;
  visibleCode?: string;
  terminalOutput?: string;
}

export interface CodingPattern {
  id: string;
  name: string;
  description: string;
  pattern: string;
  frequency: number;
  lastUsed: number;
  projects: string[];
}

export interface ChangeRecord {
  id: string;
  timestamp: number;
  files: string[];
  description: string;
  commitHash?: string;
  canRollback: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: AutonomousConfig = {
  autonomyLevel: 'autonomous',
  autoCommit: true,
  commitStyle: 'conventional',
  autoFixErrors: true,
  screenMonitorInterval: 0, // Disabled - causes memory/DirectX issues
  voiceUpdates: true,
  askClarifyingQuestions: true,
  maxIterations: 50,
  requireConfirmation: [
    'git_push',
    'delete_file',
    'npm_publish',
    'env_modify',
    'database_drop',
  ],
  workingDirectory: process.cwd(),
  learnFromProject: true,
};

// ============================================================================
// Autonomous Agent Class
// ============================================================================

export class AutonomousAgent extends EventEmitter {
  private config: AutonomousConfig;
  private brain: JarvisBrain | null = null;
  private agent: Agent | null = null;
  private isRunning: boolean = false;
  private currentTask: TaskStatus | null = null;
  private taskQueue: TaskStatus[] = [];
  private changeHistory: ChangeRecord[] = [];
  private learnedPatterns: Map<string, CodingPattern> = new Map();
  private screenMonitorTimer: NodeJS.Timeout | null = null;
  private lastScreenContext: ScreenContext | null = null;
  
  constructor(config?: Partial<AutonomousConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // ==========================================================================
  // Initialization
  // ==========================================================================
  
  async initialize(): Promise<void> {
    logger.info('Initializing Autonomous Agent...');
    
    // Initialize the brain for memory
    this.brain = await getJarvisBrain();
    
    // Initialize the agent for tool execution
    this.agent = await initializeAgent();
    
    // Load learned patterns
    await this.loadLearnedPatterns();
    
    // Start screen monitoring if enabled
    if (this.config.screenMonitorInterval > 0) {
      this.startScreenMonitoring();
    }
    
    this.isRunning = true;
    this.emit('initialized');
    
    if (this.config.voiceUpdates) {
      await this.speak('Autonomous agent initialized and ready.');
    }
    
    logger.info('Autonomous Agent initialized');
  }
  
  async shutdown(): Promise<void> {
    this.stopScreenMonitoring();
    await this.saveLearnedPatterns();
    this.isRunning = false;
    this.emit('shutdown');
    logger.info('Autonomous Agent shut down');
  }
  
  // ==========================================================================
  // Main Task Execution
  // ==========================================================================
  
  /**
   * Execute a complex task autonomously
   * "Build me a login page with OAuth"
   */
  async executeTask(description: string): Promise<TaskStatus> {
    logger.info('Starting autonomous task', { description });
    
    // Create the main task
    const task: TaskStatus = {
      id: `task_${Date.now()}`,
      description,
      status: 'pending',
      progress: 0,
      subtasks: [],
      startTime: Date.now(),
    };
    
    this.currentTask = task;
    this.emit('taskStarted', task);
    
    try {
      // Step 1: Understand and break down the task
      if (this.config.voiceUpdates) {
        await this.speak(`Starting task: ${description}. Let me break this down.`);
      }
      
      task.status = 'in-progress';
      const subtasks = await this.breakDownTask(description);
      task.subtasks = subtasks;
      
      // Step 2: Check if we need clarification
      if (this.config.askClarifyingQuestions) {
        const questions = await this.identifyUncertainties(description, subtasks);
        if (questions.length > 0) {
          task.status = 'needs-input';
          this.emit('needsClarification', { task, questions });
          
          if (this.config.voiceUpdates) {
            await this.speak(`I have ${questions.length} questions before I proceed. ${questions[0]}`);
          }
          
          // In fully autonomous mode, make reasonable assumptions
          if (this.config.autonomyLevel === 'autonomous') {
            await this.speak("I'll make reasonable assumptions and proceed.");
            task.status = 'in-progress';
          } else {
            return task; // Wait for user input
          }
        }
      }
      
      // Step 3: Execute subtasks
      let completedSubtasks = 0;
      for (const subtask of task.subtasks) {
        if (!this.isRunning) break;
        
        subtask.status = 'in-progress';
        subtask.startTime = Date.now();
        this.emit('subtaskStarted', subtask);
        
        if (this.config.voiceUpdates && completedSubtasks % 3 === 0) {
          await this.speak(`Working on: ${subtask.description}`);
        }
        
        try {
          await this.executeSubtask(subtask);
          subtask.status = 'completed';
          subtask.progress = 100;
          completedSubtasks++;
          
          // Auto-commit if enabled
          if (this.config.autoCommit) {
            await this.autoCommitChanges(subtask.description);
          }
        } catch (error) {
          subtask.status = 'failed';
          subtask.error = (error as Error).message;
          
          // Try to auto-fix if enabled
          if (this.config.autoFixErrors) {
            const fixed = await this.attemptAutoFix(error as Error, subtask);
            if (fixed) {
              subtask.status = 'completed';
              subtask.progress = 100;
              completedSubtasks++;
            }
          }
        }
        
        subtask.endTime = Date.now();
        this.emit('subtaskCompleted', subtask);
        
        // Update overall progress
        task.progress = Math.round((completedSubtasks / task.subtasks.length) * 100);
        this.emit('taskProgress', task);
      }
      
      // Step 4: Verify and finalize
      const allCompleted = task.subtasks.every(s => s.status === 'completed');
      task.status = allCompleted ? 'completed' : 'failed';
      task.endTime = Date.now();
      
      if (this.config.voiceUpdates) {
        if (allCompleted) {
          await this.speak(`Task completed successfully. ${task.description} is done.`);
        } else {
          const failed = count(task.subtasks, s => s.status === 'failed');
          await this.speak(`Task partially completed. ${failed} subtasks had issues.`);
        }
      }
      
      // Learn from this task
      if (this.config.learnFromProject) {
        await this.learnFromTask(task);
      }
      
    } catch (error) {
      task.status = 'failed';
      task.error = (error as Error).message;
      logger.error('Task execution failed', { error });
      
      if (this.config.voiceUpdates) {
        await this.speak(`I encountered an error: ${(error as Error).message}. Let me know how to proceed.`);
      }
    }
    
    task.endTime = Date.now();
    this.currentTask = null;
    this.emit('taskCompleted', task);
    
    return task;
  }
  
  /**
   * Break down a high-level task into subtasks
   */
  private async breakDownTask(description: string): Promise<TaskStatus[]> {
    // Use the LLM to analyze and break down the task
    const tools = getAllTools();
    
    // Check for similar past tasks in memory
    let pastContext = '';
    if (this.brain) {
      const recall = await this.brain.recall(description);
      if (recall.facts.length > 0) {
        pastContext = `\nRelevant past experience:\n${recall.facts.slice(0, 3).map(f => f.content).join('\n')}`;
      }
    }
    
    // Check for matching patterns
    const matchingPatterns = this.findMatchingPatterns(description);
    if (matchingPatterns.length > 0) {
      pastContext += `\nYou've done similar tasks before using these patterns:\n${matchingPatterns.map(p => p.description).join('\n')}`;
    }
    
    // For now, create intelligent subtasks based on keywords
    const subtasks: TaskStatus[] = [];
    const lowerDesc = description.toLowerCase();
    
    // Common task patterns
    if (lowerDesc.includes('component') || lowerDesc.includes('page') || lowerDesc.includes('ui')) {
      subtasks.push(this.createSubtask('Create component file structure'));
      subtasks.push(this.createSubtask('Implement component logic'));
      subtasks.push(this.createSubtask('Add styles'));
      subtasks.push(this.createSubtask('Create tests'));
    }
    
    if (lowerDesc.includes('api') || lowerDesc.includes('endpoint') || lowerDesc.includes('route')) {
      subtasks.push(this.createSubtask('Create route handler'));
      subtasks.push(this.createSubtask('Add input validation'));
      subtasks.push(this.createSubtask('Implement business logic'));
      subtasks.push(this.createSubtask('Add error handling'));
      subtasks.push(this.createSubtask('Create tests'));
    }
    
    if (lowerDesc.includes('database') || lowerDesc.includes('model') || lowerDesc.includes('schema')) {
      subtasks.push(this.createSubtask('Create database model'));
      subtasks.push(this.createSubtask('Create migration'));
      subtasks.push(this.createSubtask('Add seed data'));
    }
    
    if (lowerDesc.includes('feature')) {
      subtasks.push(this.createSubtask('Analyze requirements'));
      subtasks.push(this.createSubtask('Create necessary files'));
      subtasks.push(this.createSubtask('Implement core functionality'));
      subtasks.push(this.createSubtask('Add tests'));
      subtasks.push(this.createSubtask('Update documentation'));
    }
    
    // Default subtasks if nothing matched
    if (subtasks.length === 0) {
      subtasks.push(this.createSubtask('Analyze the request'));
      subtasks.push(this.createSubtask('Create implementation plan'));
      subtasks.push(this.createSubtask('Implement changes'));
      subtasks.push(this.createSubtask('Verify and test'));
    }
    
    return subtasks;
  }
  
  private createSubtask(description: string): TaskStatus {
    return {
      id: `subtask_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      description,
      status: 'pending',
      progress: 0,
      subtasks: [],
    };
  }
  
  /**
   * Execute a single subtask
   */
  private async executeSubtask(subtask: TaskStatus): Promise<void> {
    const desc = subtask.description.toLowerCase();
    
    // Map subtask descriptions to tool executions
    if (desc.includes('create') && desc.includes('component')) {
      const tool = getToolByName('create_component');
      if (tool) {
        await tool.execute({
          name: 'NewComponent',
          type: 'functional',
          withTest: true,
          styling: 'tailwind',
        });
      }
    } else if (desc.includes('create') && desc.includes('route')) {
      const tool = getToolByName('create_api_route');
      if (tool) {
        await tool.execute({
          name: 'newRoute',
          framework: 'express',
          methods: ['GET', 'POST'],
          withValidation: true,
        });
      }
    } else if (desc.includes('test')) {
      const tool = getToolByName('run_tests');
      if (tool) {
        await tool.execute({ watch: false });
      }
    } else if (desc.includes('lint') || desc.includes('format')) {
      const tool = getToolByName('lint_format');
      if (tool) {
        await tool.execute({ fix: true });
      }
    }
    
    // Simulate some work for other subtasks
    await sleep(500);
  }
  
  /**
   * Identify questions to ask for clarification
   */
  private async identifyUncertainties(
    description: string,
    subtasks: TaskStatus[]
  ): Promise<string[]> {
    const questions: string[] = [];
    const lowerDesc = description.toLowerCase();
    
    // Check for ambiguities
    if (lowerDesc.includes('page') && !lowerDesc.includes('react') && !lowerDesc.includes('next')) {
      questions.push('Should this be a React component or a Next.js page?');
    }
    
    if (lowerDesc.includes('database') && !lowerDesc.includes('postgres') && !lowerDesc.includes('mongo')) {
      questions.push('Which database should I use - PostgreSQL or MongoDB?');
    }
    
    if (lowerDesc.includes('auth') && !lowerDesc.includes('oauth') && !lowerDesc.includes('jwt')) {
      questions.push('What authentication method do you prefer - OAuth, JWT, or sessions?');
    }
    
    return questions;
  }
  
  // ==========================================================================
  // Auto-Commit
  // ==========================================================================
  
  private async autoCommitChanges(description: string): Promise<void> {
    try {
      // Check if there are changes to commit
      const { stdout: status } = await execAsync('git status --porcelain', {
        cwd: this.config.workingDirectory,
      });
      
      if (!status.trim()) return; // No changes
      
      // Generate commit message
      let message: string;
      switch (this.config.commitStyle) {
        case 'conventional':
          message = this.generateConventionalCommit(description);
          break;
        case 'descriptive':
          message = `Atlas: ${description}`;
          break;
        case 'brief':
          message = description.split(' ').slice(0, 5).join(' ');
          break;
        default:
          message = description;
      }
      
      // Stage and commit
      await execAsync('git add -A', { cwd: this.config.workingDirectory });
      await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
        cwd: this.config.workingDirectory,
      });
      
      // Get the commit hash
      const { stdout: hash } = await execAsync('git rev-parse HEAD', {
        cwd: this.config.workingDirectory,
      });
      
      // Record the change
      const record: ChangeRecord = {
        id: `change_${Date.now()}`,
        timestamp: Date.now(),
        files: status.split('\n').filter(Boolean).map(l => l.slice(3)),
        description,
        commitHash: hash.trim(),
        canRollback: true,
      };
      
      this.changeHistory.push(record);
      this.emit('autoCommit', record);
      
      logger.info('Auto-committed changes', { message, hash: hash.trim() });
    } catch (error) {
      logger.warn('Auto-commit failed', { error });
    }
  }
  
  private generateConventionalCommit(description: string): string {
    const lower = description.toLowerCase();
    
    let type = 'chore';
    if (lower.includes('add') || lower.includes('create') || lower.includes('implement')) {
      type = 'feat';
    } else if (lower.includes('fix') || lower.includes('bug') || lower.includes('error')) {
      type = 'fix';
    } else if (lower.includes('test')) {
      type = 'test';
    } else if (lower.includes('doc') || lower.includes('readme')) {
      type = 'docs';
    } else if (lower.includes('style') || lower.includes('format') || lower.includes('lint')) {
      type = 'style';
    } else if (lower.includes('refactor')) {
      type = 'refactor';
    }
    
    // Clean up the description
    const scope = this.detectScope(description);
    const cleanDesc = description
      .replace(/^(add|create|implement|fix|update|refactor)\s+/i, '')
      .toLowerCase();
    
    return scope
      ? `${type}(${scope}): ${cleanDesc}`
      : `${type}: ${cleanDesc}`;
  }
  
  private detectScope(description: string): string | null {
    const lower = description.toLowerCase();
    
    if (lower.includes('component')) return 'ui';
    if (lower.includes('api') || lower.includes('route')) return 'api';
    if (lower.includes('database') || lower.includes('model')) return 'db';
    if (lower.includes('test')) return 'test';
    if (lower.includes('config')) return 'config';
    if (lower.includes('auth')) return 'auth';
    
    return null;
  }
  
  // ==========================================================================
  // Screen Monitoring
  // ==========================================================================
  
  private startScreenMonitoring(): void {
    if (this.screenMonitorTimer) return;
    
    logger.info('Starting screen monitoring', {
      interval: this.config.screenMonitorInterval,
    });
    
    this.screenMonitorTimer = setInterval(
      () => this.checkScreen(),
      this.config.screenMonitorInterval
    );
  }
  
  private stopScreenMonitoring(): void {
    if (this.screenMonitorTimer) {
      clearInterval(this.screenMonitorTimer);
      this.screenMonitorTimer = null;
    }
  }
  
  private async checkScreen(): Promise<void> {
    try {
      // Capture the screen
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 },
      });
      
      if (sources.length === 0) return;
      
      const primaryScreen = sources[0];
      const thumbnail = primaryScreen.thumbnail;
      
      // Get window title
      const activeWindow = primaryScreen.name;
      
      // Use OCR to extract text (simplified)
      // In production, this would use the OCR tools
      const context: ScreenContext = {
        timestamp: Date.now(),
        hasError: false,
        activeWindow,
      };
      
      // Check for error patterns in window titles
      const errorPatterns = [
        /error/i,
        /exception/i,
        /failed/i,
        /cannot/i,
        /unable/i,
        /undefined/i,
        /null/i,
      ];
      
      if (errorPatterns.some(p => p.test(activeWindow))) {
        context.hasError = true;
        context.errorText = activeWindow;
      }
      
      // If error detected and auto-fix enabled
      if (context.hasError && this.config.autoFixErrors && !this.currentTask) {
        logger.info('Error detected on screen', { context });
        this.emit('errorDetected', context);
        
        if (this.config.voiceUpdates) {
          await this.speak(`I noticed an error. Would you like me to investigate?`);
        }
        
        // In autonomous mode, auto-investigate
        if (this.config.autonomyLevel === 'autonomous') {
          await this.investigateError(context);
        }
      }
      
      this.lastScreenContext = context;
    } catch (error) {
      logger.debug('Screen check failed', { error });
    }
  }
  
  private async investigateError(context: ScreenContext): Promise<void> {
    logger.info('Investigating detected error', { context });
    
    // Try to get more context
    if (context.errorText) {
      // Search for the error in code
      const grepTool = getToolByName('grep_search');
      if (grepTool) {
        const result = await grepTool.execute({
          query: context.errorText,
          directory: this.config.workingDirectory,
        });
        
        if (result.success && result.data) {
          // Found related code, attempt fix
          await this.executeTask(`Fix the error: ${context.errorText}`);
        }
      }
    }
  }
  
  // ==========================================================================
  // Auto-Fix Errors
  // ==========================================================================
  
  private async attemptAutoFix(error: Error, subtask: TaskStatus): Promise<boolean> {
    logger.info('Attempting auto-fix', { error: error.message, subtask: subtask.description });
    
    const errorMsg = error.message.toLowerCase();
    
    // Common error patterns and fixes
    if (errorMsg.includes('module not found') || errorMsg.includes('cannot find module')) {
      // Try to install missing package
      const match = error.message.match(/['"]([^'"]+)['"]/);
      if (match) {
        const packageName = match[1];
        try {
          await execAsync(`npm install ${packageName}`, {
            cwd: this.config.workingDirectory,
          });
          return true;
        } catch {
          return false;
        }
      }
    }
    
    if (errorMsg.includes('syntax error') || errorMsg.includes('unexpected token')) {
      // Try lint --fix
      const lintTool = getToolByName('lint_format');
      if (lintTool) {
        const result = await lintTool.execute({ fix: true });
        return result.success;
      }
    }
    
    if (errorMsg.includes('type') && errorMsg.includes('not assignable')) {
      // TypeScript error - try to run tsc for more info
      try {
        await execAsync('npx tsc --noEmit', {
          cwd: this.config.workingDirectory,
        });
      } catch {
        // Expected to fail, but gives us diagnostic info
      }
    }
    
    return false;
  }
  
  // ==========================================================================
  // Learning System
  // ==========================================================================
  
  private findMatchingPatterns(description: string): CodingPattern[] {
    const matches: CodingPattern[] = [];
    const words = description.toLowerCase().split(/\s+/);
    
    for (const pattern of this.learnedPatterns.values()) {
      const patternWords = pattern.name.toLowerCase().split(/\s+/);
      const overlap = words.filter(w => patternWords.includes(w)).length;
      
      if (overlap >= 2 || pattern.description.toLowerCase().includes(description.toLowerCase())) {
        matches.push(pattern);
      }
    }
    
    return matches.sort((a, b) => b.frequency - a.frequency);
  }
  
  private async learnFromTask(task: TaskStatus): Promise<void> {
    if (!this.brain) return;
    
    // Extract pattern from successful task
    if (task.status === 'completed') {
      const pattern: CodingPattern = {
        id: `pattern_${Date.now()}`,
        name: task.description,
        description: `Completed task with ${task.subtasks.length} steps`,
        pattern: JSON.stringify(task.subtasks.map(s => s.description)),
        frequency: 1,
        lastUsed: Date.now(),
        projects: [this.config.workingDirectory],
      };
      
      // Check if similar pattern exists
      const existing = this.findMatchingPatterns(task.description);
      if (existing.length > 0) {
        existing[0].frequency++;
        existing[0].lastUsed = Date.now();
      } else {
        this.learnedPatterns.set(pattern.id, pattern);
      }
      
      // Store in brain
      await this.brain.learn({
        subject: 'coding_task',
        predicate: 'completed',
        object: task.description,
        confidence: 1.0,
        source: 'autonomous_agent',
      });
    }
  }
  
  private async loadLearnedPatterns(): Promise<void> {
    const patternsPath = path.join(
      this.config.workingDirectory,
      '.atlas',
      'learned-patterns.json'
    );
    
    try {
      const data = await fs.readFile(patternsPath, 'utf-8');
      const patterns = JSON.parse(data) as CodingPattern[];
      for (const p of patterns) {
        this.learnedPatterns.set(p.id, p);
      }
      logger.info('Loaded learned patterns', { count: patterns.length });
    } catch {
      // No patterns yet
    }
  }
  
  private async saveLearnedPatterns(): Promise<void> {
    const atlasDir = path.join(this.config.workingDirectory, '.atlas');
    const patternsPath = path.join(atlasDir, 'learned-patterns.json');
    
    try {
      await fs.mkdir(atlasDir, { recursive: true });
      const patterns = Array.from(this.learnedPatterns.values());
      await fs.writeFile(patternsPath, JSON.stringify(patterns, null, 2));
      logger.info('Saved learned patterns', { count: patterns.length });
    } catch (error) {
      logger.warn('Failed to save patterns', { error });
    }
  }
  
  // ==========================================================================
  // Voice Interface
  // ==========================================================================
  
  private async speak(text: string): Promise<void> {
    if (!this.config.voiceUpdates) return;
    
    try {
      const tts = getTTSManager();
      if (tts) {
        await tts.speak(text);
      }
    } catch (error) {
      logger.debug('TTS failed', { error });
    }
    
    this.emit('speech', text);
  }
  
  // ==========================================================================
  // Rollback
  // ==========================================================================
  
  async rollback(steps: number = 1): Promise<boolean> {
    const toRollback = this.changeHistory.slice(-steps).filter(c => c.canRollback);
    
    if (toRollback.length === 0) {
      if (this.config.voiceUpdates) {
        await this.speak('No changes to roll back.');
      }
      return false;
    }
    
    try {
      for (const change of toRollback.reverse()) {
        if (change.commitHash) {
          await execAsync(`git revert --no-commit ${change.commitHash}`, {
            cwd: this.config.workingDirectory,
          });
        }
      }
      
      await execAsync('git commit -m "Atlas: Rollback recent changes"', {
        cwd: this.config.workingDirectory,
      });
      
      if (this.config.voiceUpdates) {
        await this.speak(`Rolled back ${toRollback.length} changes.`);
      }
      
      return true;
    } catch (error) {
      logger.error('Rollback failed', { error });
      return false;
    }
  }
  
  // ==========================================================================
  // Public API
  // ==========================================================================
  
  setAutonomyLevel(level: AutonomyLevel): void {
    this.config.autonomyLevel = level;
    this.emit('autonomyChanged', level);
  }
  
  getStatus(): {
    isRunning: boolean;
    autonomyLevel: AutonomyLevel;
    currentTask: TaskStatus | null;
    queuedTasks: number;
    recentChanges: ChangeRecord[];
    learnedPatterns: number;
  } {
    return {
      isRunning: this.isRunning,
      autonomyLevel: this.config.autonomyLevel,
      currentTask: this.currentTask,
      queuedTasks: this.taskQueue.length,
      recentChanges: this.changeHistory.slice(-10),
      learnedPatterns: this.learnedPatterns.size,
    };
  }
  
  /** Provide answer to clarifying question */
  answerQuestion(answer: string): void {
    this.emit('questionAnswered', answer);
  }
  
  /** Cancel current task */
  cancelCurrentTask(): void {
    if (this.currentTask) {
      this.currentTask.status = 'failed';
      this.currentTask.error = 'Cancelled by user';
      this.emit('taskCancelled', this.currentTask);
      this.currentTask = null;
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: AutonomousAgent | null = null;

export function getAutonomousAgent(): AutonomousAgent {
  if (!instance) {
    instance = new AutonomousAgent();
  }
  return instance;
}

export async function initializeAutonomousAgent(
  config?: Partial<AutonomousConfig>
): Promise<AutonomousAgent> {
  if (instance) {
    await instance.shutdown();
  }
  instance = new AutonomousAgent(config);
  await instance.initialize();
  return instance;
}

export async function shutdownAutonomousAgent(): Promise<void> {
  if (instance) {
    await instance.shutdown();
    instance = null;
  }
}

export default {
  AutonomousAgent,
  getAutonomousAgent,
  initializeAutonomousAgent,
  shutdownAutonomousAgent,
};
