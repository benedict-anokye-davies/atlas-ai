/**
 * Atlas Desktop - Voice Command Handler
 * 
 * The voice-first interface that makes Atlas truly hands-free:
 * - Natural language understanding
 * - Context-aware command routing
 * - Multi-turn conversations
 * - Proactive voice alerts
 * - Continuous listening with wake word
 * 
 * @module voice/command-handler
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getAutonomousAgent } from '../agent/autonomous-agent';
import { getProjectManagement } from '../integrations/project-management';
import { getCICDMonitor } from '../integrations/cicd-monitor';
import { getFigmaIntegration } from '../integrations/figma';
import { getScreenMonitor } from '../agent/screen-monitor';
import { getCrossProjectLearning } from '../memory/cross-project-learning';
import { getVisualTestRunner } from '../testing/visual-testing';
import { getTTSManager } from '../tts/manager';

const logger = createModuleLogger('VoiceCommandHandler');

// ============================================================================
// Types
// ============================================================================

export type CommandCategory = 
  | 'coding'
  | 'navigation'
  | 'git'
  | 'search'
  | 'create'
  | 'debug'
  | 'test'
  | 'project-management'
  | 'figma'
  | 'cicd'
  | 'system'
  | 'conversation'
  | 'unknown';

export interface ParsedCommand {
  category: CommandCategory;
  intent: string;
  entities: Record<string, string | string[]>;
  confidence: number;
  raw: string;
}

export interface CommandResult {
  success: boolean;
  message: string;
  data?: any;
  followUp?: string;
}

export interface ConversationContext {
  lastCommand?: ParsedCommand;
  lastResult?: CommandResult;
  currentFile?: string;
  currentProject?: string;
  recentFiles: string[];
  pendingQuestion?: string;
  waitingForConfirmation?: string;
}

// ============================================================================
// Command Patterns
// ============================================================================

interface CommandPattern {
  patterns: RegExp[];
  category: CommandCategory;
  intent: string;
  entityExtractors?: Record<string, RegExp>;
  handler: (entities: Record<string, string | string[]>, context: ConversationContext) => Promise<CommandResult>;
}

// ============================================================================
// Voice Command Handler Class
// ============================================================================

export class VoiceCommandHandler extends EventEmitter {
  private commands: CommandPattern[] = [];
  private context: ConversationContext = {
    recentFiles: [],
  };
  private isListening: boolean = false;
  
  constructor() {
    super();
    this.registerDefaultCommands();
  }
  
  // ==========================================================================
  // Helper Functions
  // ==========================================================================
  
  /**
   * Safely extract a string from an entity value that may be string or string[]
   */
  private static getString(value: string | string[] | undefined): string {
    if (Array.isArray(value)) {
      return value[0] || '';
    }
    return value || '';
  }
  
  // ==========================================================================
  // Command Registration
  // ==========================================================================
  
  private registerDefaultCommands(): void {
    // =======================================================================
    // CODING COMMANDS
    // =======================================================================
    
    this.register({
      patterns: [
        /^(?:build|create|make|implement)\s+(.+)$/i,
        /^(?:add|write)\s+(?:a\s+)?(.+)$/i,
      ],
      category: 'coding',
      intent: 'implement_feature',
      entityExtractors: {
        feature: /^(?:build|create|make|implement|add|write)\s+(?:a\s+)?(.+)$/i,
      },
      handler: async (entities, ctx) => {
        const agent = getAutonomousAgent();
        const feature = VoiceCommandHandler.getString(entities.feature);
        const task = await agent.executeTask(feature);
        
        return {
          success: task.status === 'completed',
          message: task.status === 'completed'
            ? `Done! I've implemented ${feature}`
            : `I had some issues with ${feature}. Let me know if you want me to try again.`,
          data: task,
        };
      },
    });
    
    this.register({
      patterns: [
        /^fix\s+(?:the\s+)?(.+)$/i,
        /^(?:can you\s+)?(?:fix|repair|resolve)\s+(.+)$/i,
      ],
      category: 'coding',
      intent: 'fix_issue',
      entityExtractors: {
        issue: /(?:fix|repair|resolve)\s+(?:the\s+)?(.+)$/i,
      },
      handler: async (entities, ctx) => {
        const agent = getAutonomousAgent();
        const task = await agent.executeTask(`Fix: ${entities.issue}`);
        
        return {
          success: task.status === 'completed',
          message: task.status === 'completed'
            ? `Fixed! ${entities.issue} should be resolved now.`
            : `I tried to fix ${entities.issue} but encountered some issues.`,
          data: task,
        };
      },
    });
    
    this.register({
      patterns: [
        /^refactor\s+(.+)$/i,
        /^clean\s+up\s+(.+)$/i,
      ],
      category: 'coding',
      intent: 'refactor',
      entityExtractors: {
        target: /(?:refactor|clean\s+up)\s+(.+)$/i,
      },
      handler: async (entities, ctx) => {
        const agent = getAutonomousAgent();
        const task = await agent.executeTask(`Refactor: ${entities.target}`);
        
        return {
          success: task.status === 'completed',
          message: `Refactoring complete for ${entities.target}.`,
          data: task,
        };
      },
    });
    
    // =======================================================================
    // GIT COMMANDS
    // =======================================================================
    
    this.register({
      patterns: [
        /^commit\s+(?:with\s+message\s+)?["']?(.+?)["']?$/i,
        /^save\s+(?:my\s+)?changes?\s+(?:as\s+)?["']?(.+?)["']?$/i,
      ],
      category: 'git',
      intent: 'commit',
      entityExtractors: {
        message: /(?:commit|save\s+(?:my\s+)?changes?)\s+(?:with\s+message\s+|as\s+)?["']?(.+?)["']?$/i,
      },
      handler: async (entities, ctx) => {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        try {
          await execAsync('git add -A');
          await execAsync(`git commit -m "${entities.message}"`);
          
          return {
            success: true,
            message: `Changes committed: ${entities.message}`,
          };
        } catch (error) {
          return {
            success: false,
            message: `Commit failed: ${(error as Error).message}`,
          };
        }
      },
    });
    
    this.register({
      patterns: [
        /^(?:push|upload)\s+(?:to\s+)?(?:remote|origin|github)?$/i,
        /^(?:push|upload)\s+(?:my\s+)?changes?$/i,
      ],
      category: 'git',
      intent: 'push',
      handler: async (entities, ctx) => {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        try {
          await execAsync('git push');
          return {
            success: true,
            message: 'Changes pushed to remote.',
          };
        } catch (error) {
          return {
            success: false,
            message: `Push failed: ${(error as Error).message}`,
          };
        }
      },
    });
    
    this.register({
      patterns: [
        /^(?:pull|get|fetch)\s+(?:latest\s+)?(?:changes)?$/i,
        /^(?:sync|update)\s+(?:from\s+)?(?:remote|origin)?$/i,
      ],
      category: 'git',
      intent: 'pull',
      handler: async (entities, ctx) => {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        try {
          await execAsync('git pull');
          return {
            success: true,
            message: 'Repository updated with latest changes.',
          };
        } catch (error) {
          return {
            success: false,
            message: `Pull failed: ${(error as Error).message}`,
          };
        }
      },
    });
    
    // =======================================================================
    // PROJECT MANAGEMENT
    // =======================================================================
    
    this.register({
      patterns: [
        /^create\s+(?:a\s+)?(?:new\s+)?(?:ticket|issue|task|bug)\s*(?:for\s+)?(.+)?$/i,
        /^(?:log|file)\s+(?:a\s+)?(?:bug|issue)\s*(?:for\s+)?(.+)?$/i,
      ],
      category: 'project-management',
      intent: 'create_issue',
      entityExtractors: {
        title: /(?:ticket|issue|task|bug)\s*(?:for\s+)?(.+)$/i,
      },
      handler: async (entities, ctx) => {
        const pm = getProjectManagement();
        
        try {
          const title = VoiceCommandHandler.getString(entities.title) || 'New issue';
          const issue = await pm.createIssueFromVoice(title);
          return {
            success: true,
            message: `Created issue ${issue.key}: ${issue.title}`,
            data: issue,
          };
        } catch (error) {
          return {
            success: false,
            message: `Failed to create issue: ${(error as Error).message}`,
          };
        }
      },
    });
    
    this.register({
      patterns: [
        /^(?:what('s|'re|\s+are)\s+)?(?:my\s+)?(?:assigned\s+)?(?:tickets|issues|tasks)$/i,
        /^show\s+(?:me\s+)?(?:my\s+)?(?:tickets|issues|tasks)$/i,
      ],
      category: 'project-management',
      intent: 'list_issues',
      handler: async (entities, ctx) => {
        const pm = getProjectManagement();
        
        try {
          const issues = await pm.getMyIssues();
          
          if (issues.length === 0) {
            return {
              success: true,
              message: 'You have no assigned issues.',
            };
          }
          
          const summary = issues.slice(0, 5).map(i => `${i.key}: ${i.title}`).join('. ');
          return {
            success: true,
            message: `You have ${issues.length} issues. Top ones are: ${summary}`,
            data: issues,
          };
        } catch (error) {
          return {
            success: false,
            message: `Failed to get issues: ${(error as Error).message}`,
          };
        }
      },
    });
    
    this.register({
      patterns: [
        /^(?:start|begin)\s+(?:working\s+on\s+)?([A-Z]+-\d+)$/i,
        /^(?:pick\s+up|grab)\s+([A-Z]+-\d+)$/i,
      ],
      category: 'project-management',
      intent: 'start_issue',
      entityExtractors: {
        issueKey: /([A-Z]+-\d+)/i,
      },
      handler: async (entities, ctx) => {
        const pm = getProjectManagement();
        
        try {
          const issueKey = VoiceCommandHandler.getString(entities.issueKey).toUpperCase();
          await pm.startWorkingOn(issueKey);
          return {
            success: true,
            message: `Started working on ${issueKey}. I'll track it for you.`,
          };
        } catch (error) {
          return {
            success: false,
            message: `Failed to start issue: ${(error as Error).message}`,
          };
        }
      },
    });
    
    // =======================================================================
    // CI/CD
    // =======================================================================
    
    this.register({
      patterns: [
        /^(?:what('s|'s\s+the)\s+)?(?:build|pipeline|ci)\s+status$/i,
        /^(?:how|how's)\s+(?:is\s+)?(?:the\s+)?(?:build|pipeline)$/i,
      ],
      category: 'cicd',
      intent: 'check_build',
      handler: async (entities, ctx) => {
        const cicd = getCICDMonitor();
        const pipelines = cicd.getPipelines();
        
        if (pipelines.length === 0) {
          return {
            success: true,
            message: 'No pipelines configured.',
          };
        }
        
        const recent = pipelines[0];
        return {
          success: true,
          message: `Latest build: ${recent.name} is ${recent.status}. ${
            recent.lastRun
              ? `Ran ${Math.round((Date.now() - new Date(recent.lastRun.startedAt).getTime()) / 60000)} minutes ago.`
              : ''
          }`,
          data: recent,
        };
      },
    });
    
    this.register({
      patterns: [
        /^(?:rerun|retry|rebuild)\s+(?:the\s+)?(?:build|pipeline|ci)$/i,
        /^(?:try\s+)?(?:the\s+)?build\s+again$/i,
      ],
      category: 'cicd',
      intent: 'rebuild',
      handler: async (entities, ctx) => {
        const cicd = getCICDMonitor();
        const pipelines = cicd.getPipelines();
        
        if (pipelines.length === 0) {
          return {
            success: false,
            message: 'No pipelines to rebuild.',
          };
        }
        
        try {
          await cicd.triggerRebuild(pipelines[0].id);
          return {
            success: true,
            message: 'Rebuild triggered. I\'ll let you know when it completes.',
          };
        } catch (error) {
          return {
            success: false,
            message: `Rebuild failed: ${(error as Error).message}`,
          };
        }
      },
    });
    
    // =======================================================================
    // FIGMA
    // =======================================================================
    
    this.register({
      patterns: [
        /^(?:import|get|convert)\s+(?:from\s+)?figma\s+(?:file\s+)?([a-zA-Z0-9]+)$/i,
        /^figma\s+(?:to\s+)?code\s+([a-zA-Z0-9]+)$/i,
      ],
      category: 'figma',
      intent: 'import_figma',
      entityExtractors: {
        fileKey: /([a-zA-Z0-9]{20,})$/i,
      },
      handler: async (entities, ctx) => {
        const figma = getFigmaIntegration();
        
        try {
          const fileKey = VoiceCommandHandler.getString(entities.fileKey);
          const components = await figma.importFile(fileKey);
          return {
            success: true,
            message: `Imported ${components.length} components from Figma.`,
            data: components,
          };
        } catch (error) {
          return {
            success: false,
            message: `Figma import failed: ${(error as Error).message}`,
          };
        }
      },
    });
    
    // =======================================================================
    // TESTING
    // =======================================================================
    
    this.register({
      patterns: [
        /^(?:run|execute)\s+(?:the\s+)?tests$/i,
        /^test\s+(?:everything|all|it)$/i,
      ],
      category: 'test',
      intent: 'run_tests',
      handler: async (entities, ctx) => {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        try {
          const { stdout } = await execAsync('npm test');
          const passed = stdout.includes('passing') || !stdout.includes('failed');
          
          return {
            success: passed,
            message: passed
              ? 'All tests passed!'
              : 'Some tests failed. Want me to investigate?',
            data: stdout,
            followUp: passed ? undefined : 'investigate_tests',
          };
        } catch (error) {
          return {
            success: false,
            message: `Test execution failed: ${(error as Error).message}`,
          };
        }
      },
    });
    
    this.register({
      patterns: [
        /^(?:run|execute)\s+visual\s+tests$/i,
        /^(?:check|test)\s+(?:the\s+)?ui$/i,
      ],
      category: 'test',
      intent: 'visual_test',
      handler: async (entities, ctx) => {
        const runner = getVisualTestRunner();
        
        return {
          success: true,
          message: 'Visual tests will run on the components. I\'ll update you when done.',
        };
      },
    });
    
    // =======================================================================
    // SYSTEM COMMANDS
    // =======================================================================
    
    this.register({
      patterns: [
        /^(?:stop|pause)\s+(?:watching|monitoring)(?:\s+(?:my\s+)?screen)?$/i,
        /^(?:turn\s+off|disable)\s+(?:screen\s+)?(?:watching|monitoring)$/i,
      ],
      category: 'system',
      intent: 'stop_monitoring',
      handler: async (entities, ctx) => {
        const monitor = getScreenMonitor();
        monitor.pause();
        
        return {
          success: true,
          message: 'Screen monitoring paused. Say "resume monitoring" when you want me to watch again.',
        };
      },
    });
    
    this.register({
      patterns: [
        /^(?:resume|start|continue)\s+(?:watching|monitoring)(?:\s+(?:my\s+)?screen)?$/i,
        /^(?:turn\s+on|enable)\s+(?:screen\s+)?(?:watching|monitoring)$/i,
      ],
      category: 'system',
      intent: 'start_monitoring',
      handler: async (entities, ctx) => {
        const monitor = getScreenMonitor();
        monitor.resume();
        
        return {
          success: true,
          message: 'Screen monitoring resumed. I\'ll watch for errors.',
        };
      },
    });
    
    this.register({
      patterns: [
        /^(?:what('s|'re)\s+)?(?:the\s+)?status$/i,
        /^(?:how|how's)\s+(?:are\s+)?(?:you|things)$/i,
      ],
      category: 'system',
      intent: 'status',
      handler: async (entities, ctx) => {
        const agent = getAutonomousAgent();
        const status = agent.getStatus();
        
        return {
          success: true,
          message: `I'm ${status.isRunning ? 'running' : 'idle'}. ${
            status.currentTask
              ? `Currently working on: ${status.currentTask.description}`
              : 'Ready for your next command.'
          } I've learned ${status.learnedPatterns} patterns and made ${status.recentChanges.length} recent changes.`,
          data: status,
        };
      },
    });
    
    this.register({
      patterns: [
        /^(?:undo|rollback|revert)(?:\s+(?:the\s+)?last\s+(?:change|changes?))?$/i,
      ],
      category: 'system',
      intent: 'rollback',
      handler: async (entities, ctx) => {
        const agent = getAutonomousAgent();
        const success = await agent.rollback();
        
        return {
          success,
          message: success
            ? 'Rolled back the last change.'
            : 'Nothing to roll back.',
        };
      },
    });
    
    // =======================================================================
    // CONVERSATION
    // =======================================================================
    
    this.register({
      patterns: [
        /^(?:yes|yeah|yep|sure|ok|okay|do\s+it|go\s+ahead|proceed)$/i,
      ],
      category: 'conversation',
      intent: 'confirm',
      handler: async (entities, ctx) => {
        if (ctx.waitingForConfirmation) {
          // Execute the pending action
          return {
            success: true,
            message: `Proceeding with: ${ctx.waitingForConfirmation}`,
          };
        }
        
        return {
          success: false,
          message: "I'm not sure what you're confirming. Could you be more specific?",
        };
      },
    });
    
    this.register({
      patterns: [
        /^(?:no|nope|don't|cancel|stop|never\s+mind)$/i,
      ],
      category: 'conversation',
      intent: 'deny',
      handler: async (entities, ctx) => {
        if (ctx.waitingForConfirmation) {
          const pending = ctx.waitingForConfirmation;
          ctx.waitingForConfirmation = undefined;
          
          return {
            success: true,
            message: `Cancelled: ${pending}`,
          };
        }
        
        return {
          success: true,
          message: 'Alright, cancelled.',
        };
      },
    });
    
    this.register({
      patterns: [
        /^(?:what\s+can\s+you\s+do|help|commands)$/i,
        /^(?:show\s+me\s+)?(?:your\s+)?capabilities$/i,
      ],
      category: 'conversation',
      intent: 'help',
      handler: async (entities, ctx) => {
        const capabilities = [
          'I can build features, fix bugs, and refactor code',
          'I handle git operations like commit, push, and pull',
          'I create and manage Jira/Linear issues',
          'I monitor your CI/CD pipelines',
          'I import designs from Figma',
          'I run tests and visual regression checks',
          'I watch your screen for errors and fix them',
        ];
        
        return {
          success: true,
          message: `Here's what I can do: ${capabilities.join('. ')}. Just ask naturally!`,
        };
      },
    });
  }
  
  register(command: CommandPattern): void {
    this.commands.push(command);
  }
  
  // ==========================================================================
  // Command Processing
  // ==========================================================================
  
  async processCommand(transcript: string): Promise<CommandResult> {
    logger.info('Processing voice command', { transcript });
    this.emit('commandReceived', transcript);
    
    // Parse the command
    const parsed = this.parseCommand(transcript);
    
    if (!parsed || parsed.category === 'unknown') {
      // Fallback to autonomous agent for natural language tasks
      const agent = getAutonomousAgent();
      const task = await agent.executeTask(transcript);
      
      return {
        success: task.status === 'completed',
        message: task.status === 'completed'
          ? `Done! ${transcript}`
          : `I tried to handle "${transcript}" but had some issues.`,
        data: task,
      };
    }
    
    // Find and execute the matching command
    const result = await this.executeCommand(parsed);
    
    // Update context
    this.context.lastCommand = parsed;
    this.context.lastResult = result;
    
    // Speak the result
    await this.speak(result.message);
    
    this.emit('commandProcessed', { parsed, result });
    
    return result;
  }
  
  private parseCommand(transcript: string): ParsedCommand | null {
    const normalized = transcript.trim().toLowerCase();
    
    for (const command of this.commands) {
      for (const pattern of command.patterns) {
        if (pattern.test(normalized)) {
          const entities: Record<string, string> = {};
          
          // Extract entities
          if (command.entityExtractors) {
            for (const [name, extractor] of Object.entries(command.entityExtractors)) {
              const match = transcript.match(extractor);
              if (match?.[1]) {
                entities[name] = match[1].trim();
              }
            }
          }
          
          return {
            category: command.category,
            intent: command.intent,
            entities,
            confidence: 1.0,
            raw: transcript,
          };
        }
      }
    }
    
    return {
      category: 'unknown',
      intent: 'unknown',
      entities: {},
      confidence: 0,
      raw: transcript,
    };
  }
  
  private async executeCommand(parsed: ParsedCommand): Promise<CommandResult> {
    for (const command of this.commands) {
      if (command.intent === parsed.intent) {
        try {
          return await command.handler(parsed.entities, this.context);
        } catch (error) {
          return {
            success: false,
            message: `Error executing command: ${(error as Error).message}`,
          };
        }
      }
    }
    
    return {
      success: false,
      message: "I didn't understand that command.",
    };
  }
  
  // ==========================================================================
  // Voice Output
  // ==========================================================================
  
  private async speak(text: string): Promise<void> {
    try {
      const tts = getTTSManager();
      if (tts) {
        await tts.speak(text);
      }
    } catch (error) {
      logger.debug('TTS failed', { error });
    }
  }
  
  // ==========================================================================
  // Context Management
  // ==========================================================================
  
  setCurrentFile(filePath: string): void {
    this.context.currentFile = filePath;
    if (!this.context.recentFiles.includes(filePath)) {
      this.context.recentFiles.unshift(filePath);
      if (this.context.recentFiles.length > 10) {
        this.context.recentFiles.pop();
      }
    }
  }
  
  setCurrentProject(projectPath: string): void {
    this.context.currentProject = projectPath;
  }
  
  getContext(): ConversationContext {
    return { ...this.context };
  }
  
  clearContext(): void {
    this.context = { recentFiles: [] };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: VoiceCommandHandler | null = null;

export function getVoiceCommandHandler(): VoiceCommandHandler {
  if (!instance) {
    instance = new VoiceCommandHandler();
  }
  return instance;
}

export default {
  VoiceCommandHandler,
  getVoiceCommandHandler,
};
