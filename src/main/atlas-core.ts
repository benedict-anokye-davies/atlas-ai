/**
 * Atlas Desktop - Main Integration Module
 * 
 * This is the brain that connects EVERYTHING together:
 * - Autonomous coding agent
 * - Voice-first interface
 * - Screen monitoring
 * - Cross-project learning
 * - CI/CD monitoring
 * - Project management (Jira/Linear)
 * - Figma design-to-code
 * - Visual testing
 * 
 * Simply initialize this module and Atlas becomes truly autonomous.
 * 
 * @module atlas-core
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from './utils/logger';
import { getStore } from './store';
import { getJarvisBrain, initializeJarvisBrain } from './cognitive';
import {
  AutonomousAgent,
  getAutonomousAgent,
  initializeAutonomousAgent,
} from './agent/autonomous-agent';
import {
  ContinuousScreenMonitor,
  getScreenMonitor,
  startScreenMonitor,
} from './agent/screen-monitor';
import {
  CrossProjectLearning,
  getCrossProjectLearning,
} from './memory/cross-project-learning';
import {
  VoiceCommandHandler,
  getVoiceCommandHandler,
} from './voice/command-handler';
import { FigmaIntegration, getFigmaIntegration } from './integrations/figma';
import { CICDMonitor, getCICDMonitor } from './integrations/cicd-monitor';
import { ProjectManagement, getProjectManagement } from './integrations/project-management';
import { VisualTestRunner, getVisualTestRunner, initializeVisualTesting } from './testing/visual-testing';
import { getTTSManager } from './tts/manager';

const logger = createModuleLogger('AtlasCore');

// ============================================================================
// Types
// ============================================================================

export interface AtlasConfig {
  /** Enable voice-first interaction */
  voiceEnabled: boolean;
  
  /** Wake word for activation ("hey atlas" by default) */
  wakeWord: string;
  
  /** Enable continuous screen monitoring */
  screenMonitoring: boolean;
  
  /** Enable autonomous mode (no approvals needed) */
  autonomous: boolean;
  
  /** Auto-commit changes to git */
  autoCommit: boolean;
  
  /** Enable cross-project learning */
  crossProjectLearning: boolean;
  
  /** LLM provider (fireworks, openrouter) */
  llmProvider: 'fireworks' | 'openrouter';
  
  /** Model to use */
  model: string;
  
  /** Working directory */
  workingDirectory: string;
  
  /** Voice alerts for important events */
  voiceAlerts: boolean;
}

export interface AtlasStatus {
  initialized: boolean;
  voiceActive: boolean;
  screenMonitoring: boolean;
  autonomousMode: boolean;
  currentTask?: string;
  recentChanges: number;
  learnedPatterns: number;
  errorsDetected: number;
  uptime: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: AtlasConfig = {
  voiceEnabled: true,
  wakeWord: 'hey atlas',
  screenMonitoring: true,
  autonomous: true,
  autoCommit: true,
  crossProjectLearning: true,
  llmProvider: 'fireworks',
  model: 'accounts/fireworks/models/deepseek-v3p2',
  workingDirectory: process.cwd(),
  voiceAlerts: true,
};

// ============================================================================
// Atlas Core Class
// ============================================================================

export class AtlasCore extends EventEmitter {
  private config: AtlasConfig;
  private isInitialized: boolean = false;
  private startTime: number = 0;
  
  // Subsystems
  private agent: AutonomousAgent | null = null;
  private screenMonitor: ContinuousScreenMonitor | null = null;
  private learning: CrossProjectLearning | null = null;
  private voiceHandler: VoiceCommandHandler | null = null;
  private cicd: CICDMonitor | null = null;
  private projectManagement: ProjectManagement | null = null;
  private figma: FigmaIntegration | null = null;
  private visualTesting: VisualTestRunner | null = null;
  
  constructor(config?: Partial<AtlasConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // ==========================================================================
  // Initialization
  // ==========================================================================
  
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    logger.info('🚀 Initializing Atlas Core...');
    this.startTime = Date.now();
    
    try {
      // 1. Initialize the brain (memory, knowledge graph)
      logger.info('Initializing cognitive systems...');
      await initializeJarvisBrain({
        autoLearnThreshold: 0.7,
        silentLearning: true,
        enableReasoning: true,
      });
      
      // 2. Initialize autonomous agent
      logger.info('Initializing autonomous agent...');
      this.agent = await initializeAutonomousAgent({
        autonomyLevel: this.config.autonomous ? 'autonomous' : 'trusted',
        autoCommit: this.config.autoCommit,
        autoFixErrors: true,
        voiceUpdates: this.config.voiceAlerts,
        workingDirectory: this.config.workingDirectory,
        learnFromProject: true,
      });
      
      // 3. Initialize screen monitor
      if (this.config.screenMonitoring) {
        logger.info('Initializing screen monitoring...');
        this.screenMonitor = await startScreenMonitor({
          enabled: true,
          pollInterval: 3000,
          captureOnError: true,
          onError: (error) => this.handleScreenError(error),
        });
      }
      
      // 4. Initialize cross-project learning
      if (this.config.crossProjectLearning) {
        logger.info('Initializing cross-project learning...');
        this.learning = await getCrossProjectLearning();
        this.learning.registerProject(this.config.workingDirectory);
      }
      
      // 5. Initialize voice handler
      if (this.config.voiceEnabled) {
        logger.info('Initializing voice interface...');
        this.voiceHandler = getVoiceCommandHandler();
        this.voiceHandler.setCurrentProject(this.config.workingDirectory);
      }
      
      // 6. Initialize integrations
      logger.info('Initializing integrations...');
      this.cicd = getCICDMonitor();
      this.projectManagement = getProjectManagement();
      this.figma = getFigmaIntegration();
      this.visualTesting = await initializeVisualTesting();
      
      // 7. Wire up event handlers
      this.setupEventHandlers();
      
      // 8. Load configurations from store
      await this.loadStoredConfigurations();
      
      this.isInitialized = true;
      this.emit('initialized');
      
      // Welcome message
      if (this.config.voiceAlerts) {
        await this.speak("Atlas is online and ready. I'm watching your screen and listening for commands.");
      }
      
      logger.info('✅ Atlas Core initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize Atlas Core', { error });
      throw error;
    }
  }
  
  async shutdown(): Promise<void> {
    logger.info('Shutting down Atlas Core...');
    
    if (this.screenMonitor) {
      await this.screenMonitor.stop();
    }
    
    if (this.agent) {
      await (this.agent as any).shutdown?.();
    }
    
    if (this.learning) {
      await this.learning.close();
    }
    
    if (this.cicd) {
      this.cicd.stopAll();
    }
    
    if (this.visualTesting) {
      this.visualTesting.cleanup();
    }
    
    this.isInitialized = false;
    this.emit('shutdown');
    
    logger.info('Atlas Core shut down');
  }
  
  // ==========================================================================
  // Event Handlers
  // ==========================================================================
  
  private setupEventHandlers(): void {
    // Screen monitor events
    if (this.screenMonitor) {
      this.screenMonitor.on('errorDetected', (error) => {
        this.emit('errorDetected', error);
      });
    }
    
    // Autonomous agent events
    if (this.agent) {
      this.agent.on('taskStarted', (task) => {
        this.emit('taskStarted', task);
      });
      
      this.agent.on('taskCompleted', (task) => {
        this.emit('taskCompleted', task);
        
        // Learn from completed task
        if (this.learning && task.status === 'completed') {
          this.learning.learnPattern({
            name: task.description,
            description: `Task with ${task.subtasks.length} subtasks`,
            category: 'other',
            code: JSON.stringify(task),
            language: 'typescript',
            usage: { timesUsed: 1, timesModified: 0, timesSuggested: 0, timesAccepted: 0 },
            projects: [this.config.workingDirectory],
          });
        }
      });
      
      this.agent.on('autoCommit', (record) => {
        this.emit('autoCommit', record);
        
        // Update Jira/Linear if configured
        this.projectManagement?.linkCommit?.(
          record.description,
          record.commitHash || '',
          record.description
        );
      });
    }
    
    // CI/CD events
    if (this.cicd) {
      this.cicd.on('buildFailure', async (data) => {
        this.emit('buildFailure', data);
        
        if (this.config.voiceAlerts) {
          await this.speak(`Build failed: ${data.failure.errorMessage}`);
        }
        
        // Auto-investigate if autonomous
        if (this.config.autonomous && this.agent) {
          await this.agent.executeTask(`Investigate and fix CI failure: ${data.failure.errorMessage}`);
        }
      });
      
      this.cicd.on('buildSuccess', async (pipeline) => {
        this.emit('buildSuccess', pipeline);
        
        if (this.config.voiceAlerts) {
          await this.speak(`Build passed: ${pipeline.name}`);
        }
      });
    }
  }
  
  private async handleScreenError(error: any): Promise<void> {
    logger.info('Screen error detected', { error: error.message });
    
    if (this.config.voiceAlerts) {
      await this.speak(`I noticed an error: ${error.message}. Want me to fix it?`);
    }
    
    if (this.config.autonomous && this.agent && error.canAutoFix) {
      await this.agent.executeTask(`Fix detected error: ${error.message}`);
    }
    
    this.emit('errorDetected', error);
  }
  
  // ==========================================================================
  // Voice Interface
  // ==========================================================================
  
  async processVoiceCommand(transcript: string): Promise<any> {
    if (!this.voiceHandler) {
      throw new Error('Voice handler not initialized');
    }
    
    return this.voiceHandler.processCommand(transcript);
  }
  
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
  // Task Execution
  // ==========================================================================
  
  async executeTask(description: string): Promise<any> {
    if (!this.agent) {
      throw new Error('Agent not initialized');
    }
    
    return this.agent.executeTask(description);
  }
  
  // ==========================================================================
  // Configuration
  // ==========================================================================
  
  private async loadStoredConfigurations(): Promise<void> {
    const store = getStore();
    
    // Load GitHub Actions config from nested apiKeys and cicd objects
    const storeData = store.getAll();
    const ghToken = storeData.apiKeys?.github;
    if (ghToken) {
      const owner = storeData.cicd?.owner;
      const repo = storeData.cicd?.repo;
      
      if (owner && repo) {
        this.cicd?.addProvider('github', {
          provider: 'github-actions',
          apiToken: ghToken,
          repoOwner: owner,
          repoName: repo,
          pollInterval: storeData.cicd?.pollInterval ?? 60000,
          voiceAlerts: this.config.voiceAlerts,
          autoInvestigate: true,
          autoFix: this.config.autonomous,
        });
        this.cicd?.startAll();
      }
    }
    
    // Load Linear config
    const linearToken = storeData.apiKeys?.linear;
    if (linearToken) {
      this.projectManagement?.configure({
        provider: 'linear',
        apiToken: linearToken,
        teamId: storeData.projectManagement?.teamId,
      });
    }
    
    // Load Figma config
    const figmaToken = storeData.apiKeys?.figma;
    if (figmaToken) {
      await this.figma?.initialize(figmaToken);
    }
  }
  
  setConfig(config: Partial<AtlasConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Update subsystems
    if (this.agent) {
      this.agent.setAutonomyLevel(
        config.autonomous ? 'autonomous' : 'trusted'
      );
    }
    
    if (this.screenMonitor) {
      if (config.screenMonitoring === false) {
        this.screenMonitor.pause();
      } else if (config.screenMonitoring === true) {
        this.screenMonitor.resume();
      }
    }
    
    this.emit('configChanged', this.config);
  }
  
  getConfig(): AtlasConfig {
    return { ...this.config };
  }
  
  // ==========================================================================
  // Status
  // ==========================================================================
  
  getStatus(): AtlasStatus {
    const agentStatus = this.agent?.getStatus();
    const monitorStatus = this.screenMonitor?.getStatus();
    
    return {
      initialized: this.isInitialized,
      voiceActive: this.config.voiceEnabled,
      screenMonitoring: monitorStatus?.enabled ?? false,
      autonomousMode: this.config.autonomous,
      currentTask: agentStatus?.currentTask?.description,
      recentChanges: agentStatus?.recentChanges.length ?? 0,
      learnedPatterns: agentStatus?.learnedPatterns ?? 0,
      errorsDetected: monitorStatus?.errorCount ?? 0,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
    };
  }
  
  // ==========================================================================
  // Subsystem Access
  // ==========================================================================
  
  getAgent(): AutonomousAgent | null {
    return this.agent;
  }
  
  getScreenMonitor(): ContinuousScreenMonitor | null {
    return this.screenMonitor;
  }
  
  getLearning(): CrossProjectLearning | null {
    return this.learning;
  }
  
  getCICD(): CICDMonitor | null {
    return this.cicd;
  }
  
  getProjectManagement(): ProjectManagement | null {
    return this.projectManagement;
  }
  
  getFigma(): FigmaIntegration | null {
    return this.figma;
  }
  
  getVisualTesting(): VisualTestRunner | null {
    return this.visualTesting;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: AtlasCore | null = null;

export function getAtlasCore(): AtlasCore {
  if (!instance) {
    instance = new AtlasCore();
  }
  return instance;
}

export async function initializeAtlas(config?: Partial<AtlasConfig>): Promise<AtlasCore> {
  if (instance) {
    await instance.shutdown();
  }
  instance = new AtlasCore(config);
  await instance.initialize();
  return instance;
}

export async function shutdownAtlas(): Promise<void> {
  if (instance) {
    await instance.shutdown();
    instance = null;
  }
}

// ============================================================================
// Quick Start Function
// ============================================================================

/**
 * Quick start Atlas with sensible defaults.
 * Just call this on app startup!
 */
export async function startAtlas(): Promise<AtlasCore> {
  const atlas = await initializeAtlas({
    voiceEnabled: true,
    wakeWord: 'hey atlas',
    screenMonitoring: true,
    autonomous: true,
    autoCommit: true,
    crossProjectLearning: true,
    llmProvider: 'fireworks',
    model: 'accounts/fireworks/models/deepseek-v3p2',
    voiceAlerts: true,
  });
  
  return atlas;
}

export default {
  AtlasCore,
  getAtlasCore,
  initializeAtlas,
  shutdownAtlas,
  startAtlas,
};
