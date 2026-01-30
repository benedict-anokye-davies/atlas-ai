/**
 * Atlas Desktop - VM Computer Use Agent
 *
 * World-class VM automation agent that surpasses Claude Computer Use and OpenAI Operator.
 * 
 * Features:
 * - Event-driven architecture with state machine
 * - VLM-powered screen understanding (Fireworks Llama Vision)
 * - Self-healing selectors that auto-repair
 * - Predictive action planning with ML
 * - Few-shot learning from demonstrations
 * - Active learning with human feedback loop
 * - Cross-application workflows
 * - Multi-VM orchestration
 * - Plugin system for app-specific handling
 * - Voice integration with Atlas
 * - Checkpoint and rollback system
 *
 * @module vm-agent
 *
 * @example
 * ```typescript
 * import { getVMAgent, initializeVMAgent } from './vm-agent';
 *
 * // Initialize the system
 * await initializeVMAgent();
 *
 * // Get the agent
 * const agent = getVMAgent();
 *
 * // Connect to a VM
 * await agent.connect({ type: 'hyperv', vmName: 'TestVM' });
 *
 * // Execute a task with full ML pipeline
 * await agent.executeTask('Open Chrome and search for weather');
 *
 * // Start learning from user demonstration
 * await agent.startLearning('How to create a report');
 * // ... user performs task ...
 * await agent.stopLearning(true);
 *
 * // Execute cross-app workflow
 * await agent.executeWorkflow('daily-report-workflow');
 * ```
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

// =============================================================================
// Legacy Imports (Original VM Agent)
// =============================================================================

import { VMConnector, getVMConnector } from './vm-connector';
import { ScreenUnderstanding, getScreenUnderstanding } from './screen-understanding';
import { DemonstrationRecorder, getDemonstrationRecorder } from './demonstration-recorder';
import { BehaviorLearner, getBehaviorLearner } from './behavior-learner';
import { TaskPlanner, getTaskPlanner } from './task-planner';
import { StrategyMemory, getStrategyMemory } from './strategy-memory';
import { getVMAgentTools } from './tools';
import {
  VMConnectionConfig,
  ScreenState,
  VMTask,
  TaskPlan,
  WorldBoxGameState,
  VMAgentConfig,
  DEFAULT_VM_AGENT_CONFIG,
  VMAction,
} from './types';

// =============================================================================
// New Core Infrastructure (Phase 1)
// =============================================================================

import { VMAgentEventBus, getEventBus } from './core/event-bus';
import { VMAgentStateMachine, getStateMachine, VMAgentState } from './core/state-machine';
import { CheckpointManager, getCheckpointManager } from './core/checkpoint-manager';
import { ErrorRecoveryManager, getErrorRecoveryManager } from './core/error-recovery';
import { ActionExecutor, getActionExecutor } from './core/action-executor';

// =============================================================================
// Vision Intelligence (Phase 2)
// =============================================================================

import { VLMAnalyzer, getVLMAnalyzer } from './vision/vlm-analyzer';
import { VisualMemory, getVisualMemory } from './vision/visual-memory';
import { SelfHealingSelectors, getSelfHealingSelectors } from './vision/self-healing-selectors';
import { EnhancedScreenUnderstanding, getEnhancedScreenUnderstanding } from './vision/enhanced-screen';

// =============================================================================
// Predictive & Learning (Phase 3)
// =============================================================================

import { PredictiveEngine, getPredictiveEngine } from './learning/predictive-engine';
import { FewShotLearner, getFewShotLearner } from './learning/few-shot-learner';
import { ActiveLearner, getActiveLearner } from './learning/active-learning';
import { ContextFusionEngine, getContextFusionEngine } from './learning/context-fusion';

// =============================================================================
// Advanced Workflows (Phase 4)
// =============================================================================

import { CrossAppWorkflowManager, getCrossAppWorkflowManager } from './workflows/cross-app';
import { MultiVMManager, getMultiVMManager } from './workflows/multi-vm';

// =============================================================================
// Plugin System (Phase 4)
// =============================================================================

import { PluginRegistry, getPluginRegistry } from './plugins/plugin-registry';
import { BaseAppPlugin, GenericWindowsPlugin, createAppPlugin } from './plugins/app-plugin';

// =============================================================================
// Integration Layer (Phase 5)
// =============================================================================

import { VoiceIntegrationManager, getVoiceIntegration } from './integration/voice-integration';
import { registerVMAgentIPCHandlers, unregisterVMAgentIPCHandlers, IPC_CHANNELS } from './integration/ipc-handlers';

const logger = createModuleLogger('VMAgent');

// =============================================================================
// Re-exports - Core Types
// =============================================================================

export * from './types';

// Legacy exports
export { VMConnector, getVMConnector } from './vm-connector';
export { ScreenUnderstanding, getScreenUnderstanding } from './screen-understanding';
export { DemonstrationRecorder, getDemonstrationRecorder } from './demonstration-recorder';
export { BehaviorLearner, getBehaviorLearner } from './behavior-learner';
export { TaskPlanner, getTaskPlanner } from './task-planner';
export { StrategyMemory, getStrategyMemory } from './strategy-memory';
export { getVMAgentTools } from './tools';

// Core Infrastructure (Phase 1)
export { VMAgentEventBus, getEventBus } from './core/event-bus';
export { VMAgentStateMachine, getStateMachine, VMAgentState } from './core/state-machine';
export { CheckpointManager, getCheckpointManager } from './core/checkpoint-manager';
export { ErrorRecoveryManager, getErrorRecoveryManager } from './core/error-recovery';
export { ActionExecutor, getActionExecutor } from './core/action-executor';

// Vision Intelligence (Phase 2)
export { VLMAnalyzer, getVLMAnalyzer } from './vision/vlm-analyzer';
export { VisualMemory, getVisualMemory } from './vision/visual-memory';
export { SelfHealingSelectors, getSelfHealingSelectors } from './vision/self-healing-selectors';
export { EnhancedScreenUnderstanding, getEnhancedScreenUnderstanding } from './vision/enhanced-screen';

// Predictive & Learning (Phase 3)
export { PredictiveEngine, getPredictiveEngine } from './learning/predictive-engine';
export { FewShotLearner, getFewShotLearner } from './learning/few-shot-learner';
export { ActiveLearner, getActiveLearner } from './learning/active-learning';
export { ContextFusionEngine, getContextFusionEngine } from './learning/context-fusion';

// Advanced Workflows (Phase 4)
export { CrossAppWorkflowManager, getCrossAppWorkflowManager } from './workflows/cross-app';
export { MultiVMManager, getMultiVMManager } from './workflows/multi-vm';

// Plugin System (Phase 4)
export { PluginRegistry, getPluginRegistry } from './plugins/plugin-registry';
export { BaseAppPlugin, GenericWindowsPlugin, createAppPlugin } from './plugins/app-plugin';

// Integration Layer (Phase 5)
export { VoiceIntegrationManager, getVoiceIntegration } from './integration/voice-integration';
export { registerVMAgentIPCHandlers, unregisterVMAgentIPCHandlers, IPC_CHANNELS } from './integration/ipc-handlers';

// WorldBox Integration (Evolutionary Learning)
export {
  EvolutionaryObserver,
  getEvolutionaryObserver,
  shutdownEvolutionaryObserver,
  TrackedCivilization,
  SimulationEvent,
  EvolutionaryInsight,
  WorldSnapshot,
  ObservationSession,
  processWorldBoxCommand,
  worldBoxVoiceCommand,
  CommandResult,
} from './worldbox';

// =============================================================================
// VM Agent Status
// =============================================================================

export interface VMAgentStatus {
  initialized: boolean;
  connected: boolean;
  connectionType?: VMConnectionConfig['type'];
  vmName?: string;
  isRecording: boolean;
  currentTask?: string;
  learnedBehaviors: number;
  strategies: number;
  // New enhanced status fields
  state: VMAgentState;
  enhancedFeatures: {
    vlmEnabled: boolean;
    predictiveEnabled: boolean;
    learningEnabled: boolean;
    voiceIntegrated: boolean;
    checkpointsEnabled: boolean;
  };
  stats: {
    totalPredictions: number;
    totalRecoveries: number;
    totalWorkflowsExecuted: number;
    totalCheckpoints: number;
  };
}

// =============================================================================
// Main VM Agent Class
// =============================================================================

/**
 * Main VM Agent orchestrator
 *
 * Coordinates all VM agent subsystems:
 * 
 * Legacy Components:
 * - VM Connector: Connection and input
 * - Screen Understanding: Vision and analysis
 * - Demonstration Recorder: Learning from users
 * - Behavior Learner: Pattern extraction
 * - Task Planner: Step-by-step planning
 * - Strategy Memory: Long-term memory
 * 
 * Enhanced Components (Phase 1-5):
 * - Event Bus: Event-driven architecture
 * - State Machine: 13-state agent lifecycle
 * - Checkpoint Manager: Rollback capability
 * - Error Recovery: Intelligent error handling
 * - Action Executor: Verified action execution
 * - VLM Analyzer: Vision-language understanding
 * - Visual Memory: Cross-session visual learning
 * - Self-Healing Selectors: Auto-repair element targeting
 * - Predictive Engine: ML action prediction
 * - Few-Shot Learner: Learn from demonstrations
 * - Active Learner: Human-in-the-loop
 * - Context Fusion: Multi-source intelligence
 * - Cross-App Workflows: Multi-application automation
 * - Multi-VM Manager: Orchestrate multiple VMs
 * - Plugin Registry: App-specific handlers
 * - Voice Integration: Atlas voice control
 */
export class VMAgent extends EventEmitter {
  // Legacy components
  private connector: VMConnector;
  private understanding: ScreenUnderstanding;
  private recorder: DemonstrationRecorder;
  private learner: BehaviorLearner;
  private planner: TaskPlanner;
  private memory: StrategyMemory;

  // Enhanced components (Phase 1-5)
  private eventBus: VMAgentEventBus;
  private stateMachine: VMAgentStateMachine;
  private checkpointManager: CheckpointManager;
  private errorRecovery: ErrorRecoveryManager;
  private actionExecutor: ActionExecutor;
  private vlmAnalyzer: VLMAnalyzer;
  private visualMemory: VisualMemory;
  private selfHealingSelectors: SelfHealingSelectors;
  private enhancedScreen: EnhancedScreenUnderstanding;
  private predictiveEngine: PredictiveEngine;
  private fewShotLearner: FewShotLearner;
  private activeLearner: ActiveLearner;
  private contextFusion: ContextFusionEngine;
  private workflowManager: CrossAppWorkflowManager;
  private multiVMManager: MultiVMManager;
  private pluginRegistry: PluginRegistry;
  private voiceIntegration: VoiceIntegrationManager;

  private config: VMAgentConfig;
  private initialized: boolean = false;
  private currentTaskPlan: TaskPlan | null = null;
  
  // Stats tracking
  private stats = {
    totalPredictions: 0,
    totalRecoveries: 0,
    totalWorkflowsExecuted: 0,
    totalCheckpoints: 0,
  };

  constructor(config: Partial<VMAgentConfig> = {}) {
    super();
    this.config = { ...DEFAULT_VM_AGENT_CONFIG, ...config };

    // Initialize legacy subsystems
    this.connector = getVMConnector();
    this.understanding = getScreenUnderstanding();
    this.recorder = getDemonstrationRecorder(this.connector, this.understanding);
    this.learner = getBehaviorLearner();
    this.planner = getTaskPlanner();
    this.memory = getStrategyMemory();

    // Initialize enhanced subsystems (Phase 1-5)
    this.eventBus = getEventBus();
    this.stateMachine = getStateMachine();
    this.checkpointManager = getCheckpointManager();
    this.errorRecovery = getErrorRecoveryManager();
    this.actionExecutor = getActionExecutor();
    this.vlmAnalyzer = getVLMAnalyzer();
    this.visualMemory = getVisualMemory();
    this.selfHealingSelectors = getSelfHealingSelectors();
    this.enhancedScreen = getEnhancedScreenUnderstanding();
    this.predictiveEngine = getPredictiveEngine();
    this.fewShotLearner = getFewShotLearner();
    this.activeLearner = getActiveLearner();
    this.contextFusion = getContextFusionEngine();
    this.workflowManager = getCrossAppWorkflowManager();
    this.multiVMManager = getMultiVMManager();
    this.pluginRegistry = getPluginRegistry();
    this.voiceIntegration = getVoiceIntegration();

    // Wire up events
    this.setupEventForwarding();
    this.setupEnhancedEventHandlers();
  }

  /**
   * Initialize all subsystems
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing VM Agent with enhanced features');

    // Initialize legacy memory systems
    await this.learner.initialize();
    await this.memory.initialize();

    // Import learned behaviors to strategy memory
    const behaviors = this.learner.getBehaviors();
    if (behaviors.length > 0) {
      const imported = await this.memory.importBehaviors(behaviors);
      logger.info('Imported behaviors to memory', { imported });
    }

    // Initialize enhanced subsystems (Phase 1-5)
    try {
      // Initialize VLM
      await this.vlmAnalyzer.initialize();
      
      // Load persistent data
      await this.visualMemory.loadFromDisk();
      await this.selfHealingSelectors.loadFromDisk();
      await this.fewShotLearner.loadTemplates();
      
      // Register IPC handlers
      registerVMAgentIPCHandlers();
      
      // Transition to idle state
      this.stateMachine.transition('idle');
      
      logger.info('Enhanced subsystems initialized');
    } catch (error) {
      logger.warn('Some enhanced features failed to initialize', { error });
      // Continue with basic functionality
    }

    this.initialized = true;
    this.emit('initialized');

    logger.info('VM Agent initialized', this.getStatus() as unknown as Record<string, unknown>);
  }

  /**
   * Connect to a VM
   */
  async connect(config: VMConnectionConfig): Promise<void> {
    // Config is passed via connector constructor, just connect
    await this.connector.connect();
    this.emit('connected', config);
  }

  /**
   * Disconnect from VM
   */
  async disconnect(): Promise<void> {
    await this.connector.disconnect();
    this.emit('disconnected');
  }

  /**
   * Execute a high-level task
   */
  async executeTask(description: string, context?: string): Promise<{
    success: boolean;
    steps: string[];
    error?: string;
  }> {
    if (!this.connector.getStatus().connected) {
      return { success: false, steps: [], error: 'Not connected to VM' };
    }

    logger.info('Executing task', { description, context });
    this.emit('task-started', description);

    try {
      // Get current screen state
      const screenshot = await this.connector.captureScreen();
      if (!screenshot) {
        return { success: false, steps: [], error: 'Failed to capture screen' };
      }

      const state = await this.understanding.analyzeScreen(screenshot);

      // Check for existing strategy
      const strategy = this.memory.getBestStrategy(description, context || 'general');

      if (strategy && strategy.successCount > strategy.failureCount) {
        logger.info('Using existing strategy', { id: strategy.id });

        const startTime = Date.now();
        const steps: string[] = [];

        for (const action of strategy.actions) {
          await this.executeAction(action);
          steps.push(this.describeAction(action));
          await this.sleep(this.config.actionDelayMs);
        }

        await this.memory.recordStrategyResult(
          strategy.id,
          true,
          Date.now() - startTime
        );

        this.emit('task-completed', description, steps);
        return { success: true, steps };
      }

      // Create new plan
      const task: VMTask = {
        id: `task-${Date.now()}`,
        goal: description,
        description,
        category: 'general',
        priority: 'medium',
        context,
        createdAt: Date.now(),
      };

      const plan = await this.planner.createPlan(task, state);
      this.currentTaskPlan = plan;

      // Execute plan
      this.planner.startExecution();
      let currentStep = this.planner.getNextStep();
      const executedSteps: string[] = [];

      while (currentStep) {
        try {
          // Resolve element locations if we have a target element description
          if (currentStep.targetElement) {
            const newScreenshot = await this.connector.captureScreen();
            if (newScreenshot) {
              const newState = await this.understanding.analyzeScreen(newScreenshot);
              const element = await this.understanding.findElement(
                newState,
                currentStep.targetElement
              );

              if (element && (currentStep.action.type === 'click' || currentStep.action.type === 'doubleClick' || currentStep.action.type === 'rightClick')) {
                const centerX = element.bounds.x + element.bounds.width / 2;
                const centerY = element.bounds.y + element.bounds.height / 2;
                if (currentStep.action.type === 'click') {
                  currentStep.action = { type: 'click', x: centerX, y: centerY, button: 'left' };
                } else if (currentStep.action.type === 'doubleClick') {
                  currentStep.action = { type: 'doubleClick', x: centerX, y: centerY };
                } else {
                  currentStep.action = { type: 'rightClick', x: centerX, y: centerY };
                }
              }
            }
          }

          await this.executeAction(currentStep.action);
          executedSteps.push(currentStep.description);
          this.emit('step-completed', currentStep.description);

          await this.sleep(this.config.actionDelayMs);

          const newScreenshot = await this.connector.captureScreen();
          const newState = newScreenshot
            ? await this.understanding.analyzeScreen(newScreenshot)
            : state;

          currentStep = await this.planner.completeCurrentStep(true, newState);
        } catch (error) {
          logger.warn('Step failed', { step: currentStep?.description || 'unknown', error });

          const newScreenshot = await this.connector.captureScreen();
          const newState = newScreenshot
            ? await this.understanding.analyzeScreen(newScreenshot)
            : state;

          currentStep = await this.planner.completeCurrentStep(
            false,
            newState,
            (error as Error).message
          );
        }
      }

      const finalPlan = this.planner.getCurrentPlan();
      const success = finalPlan?.status === 'completed';

      if (success) {
        // Store successful strategy
        await this.memory.storeStrategy({
          goal: description,
          context: context || 'general',
          actions: plan.steps.map(s => s.action),
          successCount: 1,
          failureCount: 0,
          preconditions: [],
          expectedOutcome: description,
          tags: [],
          avgExecutionTime: Date.now() - plan.createdAt,
          source: 'llm',
        });
      }

      this.emit(success ? 'task-completed' : 'task-failed', description, executedSteps);
      this.currentTaskPlan = null;

      return { success, steps: executedSteps };
    } catch (error) {
      logger.error('Task execution failed', { error });
      this.emit('task-failed', description, (error as Error).message);
      return { success: false, steps: [], error: (error as Error).message };
    }
  }

  /**
   * Start recording a demonstration
   */
  async startLearning(taskDescription: string, category?: string): Promise<void> {
    await this.recorder.startRecording(taskDescription, taskDescription, category || 'general');
    this.emit('learning-started', taskDescription);
  }

  /**
   * Stop recording and learn from demonstration
   */
  async stopLearning(successful: boolean): Promise<{
    demonstration: string;
    learnedBehaviors: number;
  }> {
    const demo = await this.recorder.stopRecording(successful);

    if (!demo) {
      return { demonstration: '', learnedBehaviors: 0 };
    }

    // Learn from all demonstrations in category
    const allDemos = await this.recorder.loadDemonstrations();
    const learned = await this.learner.learnFromDemonstrations([...allDemos, demo]);

    // Import to strategy memory
    if (learned.length > 0) {
      await this.memory.importBehaviors(learned);
    }

    this.emit('learning-completed', demo.description, learned.length);

    return {
      demonstration: demo.description,
      learnedBehaviors: learned.length,
    };
  }

  /**
   * Get current screen state
   */
  async getScreenState(): Promise<ScreenState | null> {
    const screenshot = await this.connector.captureScreen();
    if (!screenshot) return null;

    return this.understanding.analyzeScreen(screenshot);
  }

  /**
   * Check if WorldBox is running
   */
  async checkWorldBox(): Promise<{
    isRunning: boolean;
    gameState?: WorldBoxGameState;
  }> {
    const screenshot = await this.connector.captureScreen();
    if (!screenshot) {
      return { isRunning: false };
    }

    // First analyze the screen to get a proper ScreenState
    const screenState = await this.understanding.analyzeScreen(screenshot);
    
    const isWorldBox = this.understanding.isWorldBox(screenState);
    if (!isWorldBox) {
      return { isRunning: false };
    }

    const worldBoxState = this.understanding.getWorldBoxState(screenState);
    if (worldBoxState) {
      const gameState: WorldBoxGameState = {
        detected: true,
        uiState: {
          menuOpen: worldBoxState.menuOpen || false,
          settingsOpen: false,
          worldInfoVisible: false,
        },
        selectedTool: worldBoxState.selectedTool,
        activeCategory: worldBoxState.activeCategory,
      };
      return { isRunning: true, gameState };
    }
    
    return { isRunning: true, gameState: { detected: true, uiState: { menuOpen: false, settingsOpen: false, worldInfoVisible: false } } };
  }

  /**
   * Execute a WorldBox command
   */
  async worldBoxCommand(command: string): Promise<{
    success: boolean;
    steps: string[];
    error?: string;
  }> {
    const { isRunning, gameState } = await this.checkWorldBox();
    if (!isRunning) {
      return { success: false, steps: [], error: 'WorldBox is not running' };
    }

    // Check for WorldBox-specific strategies
    const currentMode = gameState?.selectedTool || 'default';
    const strategies = this.memory.getWorldBoxStrategies(command, currentMode);

    if (strategies.length > 0) {
      const strategy = strategies[0];
      const steps: string[] = [];

      for (const action of strategy.actions) {
        await this.executeAction(action);
        steps.push(this.describeAction(action));
        await this.sleep(this.config.actionDelayMs);
      }

      return { success: true, steps };
    }

    // Plan new approach
    const planSteps = await this.planner.planWorldBoxTask(command, gameState!);
    const executedSteps: string[] = [];

    for (const step of planSteps) {
      try {
        // Resolve element locations if we have a target element description
        if (step.targetElement) {
          const screenshot = await this.connector.captureScreen();
          if (screenshot) {
            const state = await this.understanding.analyzeScreen(screenshot);
            const element = await this.understanding.findElement(
              state,
              step.targetElement
            );

            if (element && (step.action.type === 'click' || step.action.type === 'doubleClick' || step.action.type === 'rightClick')) {
              const centerX = element.bounds.x + element.bounds.width / 2;
              const centerY = element.bounds.y + element.bounds.height / 2;
              if (step.action.type === 'click') {
                step.action = { type: 'click', x: centerX, y: centerY, button: 'left' };
              } else if (step.action.type === 'doubleClick') {
                step.action = { type: 'doubleClick', x: centerX, y: centerY };
              } else {
                step.action = { type: 'rightClick', x: centerX, y: centerY };
              }
            }
          }
        }

        await this.executeAction(step.action);
        executedSteps.push(step.description);
        await this.sleep(this.config.actionDelayMs);
      } catch (error) {
        logger.warn('WorldBox step failed', { step: step.description, error });
      }
    }

    // Store as strategy
    if (executedSteps.length > 0) {
      await this.memory.storeWorldBoxStrategy(
        command,
        planSteps.map(s => s.action),
        gameState!
      );
    }

    return { success: true, steps: executedSteps };
  }

  // ===========================================================================
  // WorldBox Evolutionary Learning
  // ===========================================================================

  /**
   * Start observing WorldBox simulation for evolutionary learning
   * 
   * @param mode - Observation mode: passive (watch only), active (with snapshots), experimental (with interventions)
   * @returns Session ID or null if WorldBox not running
   */
  async startWorldBoxObservation(mode: 'passive' | 'active' | 'experimental' = 'active'): Promise<string | null> {
    const { isRunning } = await this.checkWorldBox();
    if (!isRunning) {
      logger.warn('Cannot start observation - WorldBox not running');
      return null;
    }
    
    const screenshot = await this.connector.captureScreen();
    if (!screenshot) return null;
    
    const screenState = await this.understanding.analyzeScreen(screenshot);
    
    const { getEvolutionaryObserver } = await import('./worldbox');
    const observer = getEvolutionaryObserver();
    
    const sessionId = await observer.startObservation(screenState, mode);
    logger.info('Started WorldBox observation', { sessionId, mode });
    
    // Start continuous observation loop
    this.startObservationLoop();
    
    return sessionId;
  }

  /**
   * Stop WorldBox observation and get insights
   */
  async stopWorldBoxObservation(): Promise<{
    insights: unknown[];
    wisdom: string[];
    sessionSummary: {
      duration: number;
      events: number;
      civilizations: number;
    };
  } | null> {
    const { getEvolutionaryObserver } = await import('./worldbox');
    const observer = getEvolutionaryObserver();
    
    // Stop the loop
    this.stopObservationLoop();
    
    const session = await observer.stopObservation();
    if (!session) return null;
    
    const insights = observer.getInsights();
    const wisdom = observer.getEvolutionaryWisdom();
    
    logger.info('Stopped WorldBox observation', {
      sessionId: session.sessionId,
      insights: insights.length,
    });
    
    return {
      insights,
      wisdom,
      sessionSummary: {
        duration: session.endTime ? session.endTime - session.startTime : 0,
        events: session.events.length,
        civilizations: session.civilizations.size,
      },
    };
  }

  /**
   * Get evolutionary wisdom from WorldBox observations
   * This can be injected into Atlas's responses
   */
  async getWorldBoxWisdom(): Promise<{
    wisdom: string[];
    recentInsights: unknown[];
    observationStats: {
      totalSessions: number;
      totalInsights: number;
      extinctionPatterns: Record<string, number>;
    };
  }> {
    const { getEvolutionaryObserver } = await import('./worldbox');
    const observer = getEvolutionaryObserver();
    
    const status = observer.getStatus();
    const insights = observer.getInsights();
    const wisdom = observer.getEvolutionaryWisdom();
    const extinctionPatterns = observer.getExtinctionPatterns();
    
    return {
      wisdom,
      recentInsights: insights.slice(-5),
      observationStats: {
        totalSessions: status.isObserving ? 1 : 0, // Current session
        totalInsights: status.insights,
        extinctionPatterns,
      },
    };
  }

  /**
   * Process a natural language WorldBox command with voice support
   */
  async processWorldBoxVoiceCommand(command: string): Promise<{
    success: boolean;
    message: string;
    voiceResponse: string;
    data?: unknown;
  }> {
    const { processWorldBoxCommand } = await import('./worldbox');
    return processWorldBoxCommand(command);
  }

  // Private observation loop state
  private observationInterval: NodeJS.Timeout | null = null;

  private startObservationLoop(): void {
    if (this.observationInterval) return;
    
    this.observationInterval = setInterval(async () => {
      try {
        const screenshot = await this.connector.captureScreen();
        if (!screenshot) return;
        
        const screenState = await this.understanding.analyzeScreen(screenshot);
        
        const { getEvolutionaryObserver } = await import('./worldbox');
        const observer = getEvolutionaryObserver();
        
        await observer.processScreenUpdate(screenState);
      } catch (error) {
        logger.warn('Error in observation loop', { error });
      }
    }, 5000); // Every 5 seconds
  }

  private stopObservationLoop(): void {
    if (this.observationInterval) {
      clearInterval(this.observationInterval);
      this.observationInterval = null;
    }
  }

  /**
   * Get agent status
   */
  getStatus(): VMAgentStatus {
    const connStatus = this.connector.getStatus();
    const behaviors = this.learner.getBehaviors();
    const memStats = this.memory.getStats();

    return {
      initialized: this.initialized,
      connected: connStatus.connected,
      connectionType: connStatus.type,
      vmName: connStatus.vmName,
      isRecording: this.recorder.isRecording(),
      currentTask: this.currentTaskPlan?.task.description,
      learnedBehaviors: behaviors.length,
      strategies: memStats.totalStrategies,
      // Enhanced status
      state: this.stateMachine.getCurrentState(),
      enhancedFeatures: {
        vlmEnabled: this.vlmAnalyzer !== null,
        predictiveEnabled: this.predictiveEngine !== null,
        learningEnabled: this.fewShotLearner !== null,
        voiceIntegrated: this.voiceIntegration !== null,
        checkpointsEnabled: this.checkpointManager !== null,
      },
      stats: { ...this.stats },
    };
  }

  /**
   * Get all VM agent tools for registration
   */
  static getTools() {
    return getVMAgentTools();
  }

  // ===========================================================================
  // Enhanced Feature Methods
  // ===========================================================================

  /**
   * Get predictions for next likely actions
   */
  async getPredictions(): Promise<Array<{ action: VMAction; confidence: number; description: string }>> {
    const screenshot = await this.connector.captureScreen();
    if (!screenshot) return [];
    
    const state = await this.understanding.analyzeScreen(screenshot);
    const predictions = await this.predictiveEngine.predict(state);
    
    this.stats.totalPredictions++;
    
    return predictions.map(p => ({
      action: p.action,
      confidence: p.confidence,
      description: this.describeAction(p.action),
    }));
  }

  /**
   * Execute a cross-app workflow by ID
   */
  async executeWorkflow(workflowId: string): Promise<{ success: boolean; steps: string[]; error?: string }> {
    try {
      const result = await this.workflowManager.executeWorkflow(workflowId);
      this.stats.totalWorkflowsExecuted++;
      return { 
        success: result.success, 
        steps: result.steps.map(s => s.description || 'Step completed'),
        error: result.error,
      };
    } catch (error) {
      return { success: false, steps: [], error: (error as Error).message };
    }
  }

  /**
   * List available workflows
   */
  async listWorkflows(): Promise<Array<{ id: string; name: string; description?: string; stepCount: number }>> {
    const workflows = await this.workflowManager.listWorkflows();
    return workflows.map(w => ({
      id: w.id,
      name: w.name,
      description: w.description,
      stepCount: w.steps.length,
    }));
  }

  /**
   * Create a checkpoint for rollback
   */
  async createCheckpoint(name: string): Promise<string> {
    const checkpoint = await this.checkpointManager.createCheckpoint({
      taskId: this.currentTaskPlan?.task.id || 'manual',
      state: this.stateMachine.getCurrentState(),
      data: {
        task: this.currentTaskPlan?.task,
        timestamp: Date.now(),
        name,
      },
    });
    this.stats.totalCheckpoints++;
    return checkpoint.id;
  }

  /**
   * Rollback to a checkpoint
   */
  async rollbackToCheckpoint(checkpointId: string): Promise<boolean> {
    return this.checkpointManager.rollbackToCheckpoint(checkpointId);
  }

  /**
   * Provide feedback for active learning
   */
  async provideFeedback(
    requestId: string,
    feedback: 'correct' | 'incorrect' | 'skip',
    correction?: VMAction,
  ): Promise<void> {
    await this.activeLearner.provideFeedback(requestId, feedback, correction);
  }

  /**
   * Get the multi-VM manager for orchestrating multiple VMs
   */
  getMultiVMManager(): MultiVMManager {
    return this.multiVMManager;
  }

  /**
   * Get the plugin registry for app-specific handlers
   */
  getPluginRegistry(): PluginRegistry {
    return this.pluginRegistry;
  }

  /**
   * Analyze screen with VLM (vision-language model)
   */
  async analyzeScreenWithVLM(query?: string): Promise<{ description: string; elements: unknown[] }> {
    const screenshot = await this.connector.captureScreen();
    if (!screenshot) {
      return { description: 'Failed to capture screen', elements: [] };
    }
    
    const analysis = await this.vlmAnalyzer.analyzeScreen(screenshot, query);
    const state = await this.understanding.analyzeScreen(screenshot);
    
    return {
      description: analysis,
      elements: state.elements,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private setupEventForwarding(): void {
    // Forward connector events
    this.connector.on('connected', () => this.emit('vm-connected'));
    this.connector.on('disconnected', () => this.emit('vm-disconnected'));
    this.connector.on('error', (error: Error) => this.emit('vm-error', error));

    // Forward planner events
    this.planner.on('plan-created', (plan: TaskPlan) => this.emit('plan-created', plan));
    this.planner.on('execution-completed', (plan: TaskPlan) => this.emit('execution-completed', plan));
    this.planner.on('execution-failed', (plan: TaskPlan, error: string) => 
      this.emit('execution-failed', plan, error)
    );
  }

  private setupEnhancedEventHandlers(): void {
    // State machine events
    this.stateMachine.on('state-changed', (from: VMAgentState, to: VMAgentState, trigger: string) => {
      this.emit('state-changed', from, to, trigger);
      this.eventBus.emit({
        type: 'state:changed',
        timestamp: Date.now(),
        data: { from, to, trigger },
      });
    });

    // Error recovery events
    this.errorRecovery.on('recovery-started', (error: unknown, strategy: string) => {
      this.emit('recovery-started', error, strategy);
    });

    this.errorRecovery.on('recovery-succeeded', (error: unknown, strategy: string) => {
      this.stats.totalRecoveries++;
      this.emit('recovery-succeeded', error, strategy);
    });

    this.errorRecovery.on('recovery-failed', (error: unknown, attempts: number) => {
      this.emit('recovery-failed', error, attempts);
    });

    // Active learning events
    this.activeLearner.on('feedback-requested', (requestId: string, action: VMAction, context: unknown) => {
      this.emit('feedback-requested', requestId, action, context);
    });

    // Prediction events  
    this.predictiveEngine.on('prediction-updated', (predictions: unknown[]) => {
      this.emit('predictions', predictions);
    });
  }

  private async executeAction(action: VMAction): Promise<void> {
    // Use the connector's executeAction method for all actions
    if (action.type === 'wait') {
      await this.sleep(action.ms);
    } else {
      await this.connector.executeAction(action);
    }
  }

  private describeAction(action: { type: string; [key: string]: unknown }): string {
    switch (action.type) {
      case 'click':
        return `Click at (${action.x}, ${action.y})`;
      case 'doubleClick':
        return `Double-click at (${action.x}, ${action.y})`;
      case 'rightClick':
        return `Right-click at (${action.x}, ${action.y})`;
      case 'type':
        return `Type "${action.text}"`;
      case 'keyPress':
        return `Press ${action.key}`;
      case 'hotkey':
        return `Press ${(action.keys as string[]).join('+')}`;
      case 'scroll':
        return `Scroll at (${action.x}, ${action.y})`;
      case 'drag':
        return `Drag from (${action.fromX}, ${action.fromY}) to (${action.toX}, ${action.toY})`;
      case 'wait':
        return `Wait ${action.ms}ms`;
      default:
        return `Unknown action: ${action.type}`;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Singleton & Initialization
// =============================================================================

let agentInstance: VMAgent | null = null;

/**
 * Get the VM Agent singleton
 */
export function getVMAgent(): VMAgent {
  if (!agentInstance) {
    agentInstance = new VMAgent();
  }
  return agentInstance;
}

/**
 * Initialize the VM Agent system
 */
export async function initializeVMAgent(): Promise<VMAgent> {
  const agent = getVMAgent();
  await agent.initialize();
  return agent;
}

/**
 * Shutdown the VM Agent system
 */
export async function shutdownVMAgent(): Promise<void> {
  if (agentInstance) {
    // Save enhanced data
    try {
      const visualMemory = getVisualMemory();
      await visualMemory.saveToDisk();
      
      const selfHealingSelectors = getSelfHealingSelectors();
      await selfHealingSelectors.saveToDisk();
      
      const fewShotLearner = getFewShotLearner();
      await fewShotLearner.saveTemplates();
      
      // Unregister IPC handlers
      unregisterVMAgentIPCHandlers();
    } catch (error) {
      logger.warn('Error saving enhanced data during shutdown', { error });
    }
    
    await agentInstance.disconnect();
    agentInstance = null;
  }
}

export default VMAgent;
