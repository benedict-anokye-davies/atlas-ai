/**
 * Atlas Desktop - VM Agent Tools
 *
 * LLM-callable tools for autonomous VM control, learning, and task execution.
 * Uses the AgentTool interface for compatibility with the Atlas tool system.
 *
 * @module vm-agent/tools
 */

import { AgentTool, ActionResult } from '../../shared/types/agent';
import { createModuleLogger } from '../utils/logger';
import { getVMConnector, isVMConnectorInitialized } from './vm-connector';
import { getScreenUnderstanding } from './screen-understanding';
import { DemonstrationRecorder } from './demonstration-recorder';
import { getBehaviorLearner } from './behavior-learner';
import { getTaskPlanner } from './task-planner';
import { getStrategyMemory } from './strategy-memory';
import {
  VMConnectionConfig,
  VMAction,
  UIElement,
  WorldBoxGameState,
} from './types';

const logger = createModuleLogger('VMAgentTools');

// =============================================================================
// Demonstration Recorder Singleton
// =============================================================================

let recorderInstance: DemonstrationRecorder | null = null;

/**
 * Get or create the demonstration recorder instance.
 * Requires VM connector to be initialized first.
 */
function getDemonstrationRecorder(): DemonstrationRecorder {
  if (!recorderInstance) {
    if (!isVMConnectorInitialized()) {
      throw new Error('VM connector must be initialized before using demonstration recorder');
    }
    const connector = getVMConnector();
    const understanding = getScreenUnderstanding();
    recorderInstance = new DemonstrationRecorder(connector, understanding);
  }
  return recorderInstance;
}

// =============================================================================
// Helper Functions
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a successful ActionResult
 */
function success(data?: unknown): ActionResult {
  return { success: true, data };
}

/**
 * Create a failed ActionResult
 */
function failure(error: string): ActionResult {
  return { success: false, error };
}

// =============================================================================
// Tool Definitions
// =============================================================================

/**
 * Connect to a virtual machine
 */
export const vmConnect: AgentTool = {
  name: 'vm_connect',
  description: `Connect to a virtual machine via VNC, Hyper-V, VirtualBox, or VMware. 
This establishes a connection that allows Atlas to see the VM screen and control mouse/keyboard.
Use this before any other VM operations.`,
  parameters: {
    type: 'object',
    properties: {
      host: {
        type: 'string',
        description: 'VM host address (e.g., "localhost" for local VMs, IP for remote)',
      },
      port: {
        type: 'number',
        description: 'VNC port (default: 5900)',
      },
      type: {
        type: 'string',
        enum: ['vnc', 'hyperv', 'virtualbox', 'vmware'],
        description: 'Connection type',
      },
      vmName: {
        type: 'string',
        description: 'VM name for Hyper-V, VirtualBox, or VMware',
      },
      password: {
        type: 'string',
        description: 'VNC password if required',
      },
    },
    required: ['type'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const config: VMConnectionConfig = {
        host: (params.host as string) || 'localhost',
        port: (params.port as number) || 5900,
        type: params.type as 'vnc' | 'hyperv' | 'virtualbox' | 'vmware',
        vmName: params.vmName as string | undefined,
        password: params.password as string | undefined,
      };

      // Create connector with config
      const connector = getVMConnector(config);
      const connected = await connector.connect();

      if (!connected) {
        return failure('Failed to connect to VM');
      }

      return success({
        message: `Connected to ${config.type} VM${config.vmName ? ` (${config.vmName})` : ''}`,
        connectionType: config.type,
      });
    } catch (error) {
      logger.error('VM connect failed', { error: error as Error });
      return failure((error as Error).message);
    }
  },
};

/**
 * Disconnect from VM
 */
export const vmDisconnect: AgentTool = {
  name: 'vm_disconnect',
  description: 'Disconnect from the currently connected virtual machine.',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async (): Promise<ActionResult> => {
    try {
      if (!isVMConnectorInitialized()) {
        return failure('Not connected to any VM');
      }
      const connector = getVMConnector();
      await connector.disconnect();
      return success({ message: 'Disconnected from VM' });
    } catch (error) {
      return failure((error as Error).message);
    }
  },
};

/**
 * Take a screenshot of the VM
 */
export const vmScreenshot: AgentTool = {
  name: 'vm_screenshot',
  description: `Take a screenshot of the VM and analyze what's on screen.
Returns information about visible text, UI elements, and the current application.`,
  parameters: {
    type: 'object',
    properties: {
      analyze: {
        type: 'boolean',
        description: 'Whether to analyze the screenshot for UI elements and text (default: true)',
      },
    },
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      if (!isVMConnectorInitialized()) {
        return failure('Not connected to any VM');
      }

      const connector = getVMConnector();
      const understanding = getScreenUnderstanding();

      const screenshot = await connector.captureScreen();
      if (!screenshot) {
        return failure('Failed to capture screenshot');
      }

      if (params.analyze !== false) {
        const analysis = await understanding.analyzeScreen(screenshot);

        // Extract interactive elements from the elements array
        const interactiveElements = analysis.elements
          .filter((el: UIElement) => el.isInteractive)
          .slice(0, 15);

        return success({
          screenshot: screenshot.toString('base64'),
          analysis: {
            textRegions: analysis.textRegions.slice(0, 20),
            interactiveElements: interactiveElements.map((el: UIElement) => ({
              type: el.type,
              text: el.text,
              bounds: el.bounds,
              confidence: el.confidence,
            })),
            activeWindow: analysis.activeWindow,
            totalElements: analysis.elements.length,
          },
        });
      }

      return success({
        screenshot: screenshot.toString('base64'),
      });
    } catch (error) {
      logger.error('VM screenshot failed', { error: error as Error });
      return failure((error as Error).message);
    }
  },
};

/**
 * Click at a position or on an element
 */
export const vmClick: AgentTool = {
  name: 'vm_click',
  description: `Click at a specific position or on a UI element in the VM.
You can specify exact coordinates, or describe what to click and Atlas will find it.`,
  parameters: {
    type: 'object',
    properties: {
      x: {
        type: 'number',
        description: 'X coordinate to click',
      },
      y: {
        type: 'number',
        description: 'Y coordinate to click',
      },
      element: {
        type: 'string',
        description: 'Description of the element to click (e.g., "OK button", "File menu")',
      },
      button: {
        type: 'string',
        enum: ['left', 'right', 'middle'],
        description: 'Mouse button (default: left)',
      },
      doubleClick: {
        type: 'boolean',
        description: 'Whether to double-click',
      },
    },
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      if (!isVMConnectorInitialized()) {
        return failure('Not connected to any VM');
      }

      const connector = getVMConnector();
      const understanding = getScreenUnderstanding();

      let x = params.x as number | undefined;
      let y = params.y as number | undefined;
      const elementDesc = params.element as string | undefined;
      const button = (params.button as 'left' | 'right' | 'middle') || 'left';
      const isDoubleClick = params.doubleClick as boolean;

      // If element description provided, find it
      if (elementDesc && (x === undefined || y === undefined)) {
        const screenshot = await connector.captureScreen();
        if (!screenshot) {
          return failure('Failed to capture screen');
        }

        const state = await understanding.analyzeScreen(screenshot);
        const element = await understanding.findElement(state, elementDesc);

        if (!element) {
          const visibleElements = state.elements
            .filter((el: UIElement) => el.isInteractive)
            .slice(0, 10)
            .map((el: UIElement) => el.text || el.description);
          return failure(`Could not find element: "${elementDesc}". Visible elements: ${visibleElements.join(', ')}`);
        }

        x = element.center.x;
        y = element.center.y;
      }

      if (x === undefined || y === undefined) {
        return failure('Must provide x,y coordinates or element description');
      }

      // Build the action
      let action: VMAction;
      if (isDoubleClick) {
        action = { type: 'doubleClick', x, y };
      } else if (button === 'right') {
        action = { type: 'rightClick', x, y };
      } else {
        action = { type: 'click', x, y, button };
      }

      const result = await connector.executeAction(action);

      if (!result.success) {
        return failure(result.error || 'Click failed');
      }

      return success({
        message: `Clicked at (${x}, ${y})${elementDesc ? ` on "${elementDesc}"` : ''}`,
        coordinates: { x, y },
      });
    } catch (error) {
      logger.error('VM click failed', { error: error as Error });
      return failure((error as Error).message);
    }
  },
};

/**
 * Type text in the VM
 */
export const vmType: AgentTool = {
  name: 'vm_type',
  description: 'Type text in the VM. Use this after clicking on a text field.',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Text to type',
      },
      pressEnter: {
        type: 'boolean',
        description: 'Whether to press Enter after typing',
      },
    },
    required: ['text'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      if (!isVMConnectorInitialized()) {
        return failure('Not connected to any VM');
      }

      const connector = getVMConnector();
      const text = params.text as string;
      const pressEnter = params.pressEnter as boolean;

      // Type the text
      const typeAction: VMAction = { type: 'type', text };
      const result = await connector.executeAction(typeAction);

      if (!result.success) {
        return failure(result.error || 'Type failed');
      }

      // Press Enter if requested
      if (pressEnter) {
        const enterAction: VMAction = { type: 'keyPress', key: 'Return' };
        await connector.executeAction(enterAction);
      }

      return success({
        message: `Typed: "${text}"${pressEnter ? ' and pressed Enter' : ''}`,
      });
    } catch (error) {
      logger.error('VM type failed', { error: error as Error });
      return failure((error as Error).message);
    }
  },
};

/**
 * Press a key or key combination
 */
export const vmKeyPress: AgentTool = {
  name: 'vm_key_press',
  description: `Press a key or key combination in the VM.
Examples: "Enter", "Escape", "Tab", "ctrl+c", "alt+F4", "ctrl+shift+s"`,
  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'Key or key combination to press',
      },
    },
    required: ['key'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      if (!isVMConnectorInitialized()) {
        return failure('Not connected to any VM');
      }

      const connector = getVMConnector();
      const key = params.key as string;

      let action: VMAction;

      // Parse key combination
      if (key.includes('+')) {
        const keys = key.split('+').map(k => k.trim());
        action = { type: 'hotkey', keys };
      } else {
        action = { type: 'keyPress', key };
      }

      const result = await connector.executeAction(action);

      if (!result.success) {
        return failure(result.error || 'Key press failed');
      }

      return success({
        message: `Pressed: ${key}`,
      });
    } catch (error) {
      logger.error('VM key press failed', { error: error as Error });
      return failure((error as Error).message);
    }
  },
};

/**
 * Scroll in the VM
 */
export const vmScroll: AgentTool = {
  name: 'vm_scroll',
  description: 'Scroll up or down in the VM at a specific position.',
  parameters: {
    type: 'object',
    properties: {
      direction: {
        type: 'string',
        enum: ['up', 'down', 'left', 'right'],
        description: 'Scroll direction',
      },
      amount: {
        type: 'number',
        description: 'Scroll amount in pixels (default: 100)',
      },
      x: {
        type: 'number',
        description: 'X position to scroll at (default: center)',
      },
      y: {
        type: 'number',
        description: 'Y position to scroll at (default: center)',
      },
    },
    required: ['direction'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      if (!isVMConnectorInitialized()) {
        return failure('Not connected to any VM');
      }

      const connector = getVMConnector();
      const direction = params.direction as 'up' | 'down' | 'left' | 'right';
      const amount = (params.amount as number) || 100;
      const x = (params.x as number) || 960;
      const y = (params.y as number) || 540;

      let deltaX = 0;
      let deltaY = 0;

      switch (direction) {
        case 'up': deltaY = -amount; break;
        case 'down': deltaY = amount; break;
        case 'left': deltaX = -amount; break;
        case 'right': deltaX = amount; break;
      }

      const action: VMAction = { type: 'scroll', x, y, deltaX, deltaY };
      const result = await connector.executeAction(action);

      if (!result.success) {
        return failure(result.error || 'Scroll failed');
      }

      return success({
        message: `Scrolled ${direction} by ${amount}px`,
      });
    } catch (error) {
      logger.error('VM scroll failed', { error: error as Error });
      return failure((error as Error).message);
    }
  },
};

/**
 * Execute a task in the VM
 */
export const vmExecuteTask: AgentTool = {
  name: 'vm_execute_task',
  description: `Execute a high-level task in the VM. Atlas will break it down into steps and execute them.
Examples: "Open Notepad and write Hello World", "Search for cats in the browser", "Open the game WorldBox"`,
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'The task to execute',
      },
      context: {
        type: 'string',
        description: 'Optional context (e.g., application name)',
      },
    },
    required: ['task'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      if (!isVMConnectorInitialized()) {
        return failure('Not connected to any VM');
      }

      const connector = getVMConnector();
      const understanding = getScreenUnderstanding();
      const planner = getTaskPlanner();
      const memory = getStrategyMemory();

      const taskDescription = params.task as string;
      const context = params.context as string | undefined;

      // Check for existing strategy
      const strategy = memory.getBestStrategy(taskDescription, context || 'general');

      if (strategy) {
        logger.info('Using learned strategy', { strategy: strategy.id });

        // Execute strategy
        const startTime = Date.now();
        for (const action of strategy.actions) {
          await connector.executeAction(action);
          await sleep(300);
        }

        await memory.recordStrategyResult(
          strategy.id,
          true,
          Date.now() - startTime
        );

        return success({
          message: `Executed task using learned strategy: "${taskDescription}"`,
          usedStrategy: strategy.goal,
        });
      }

      // Get current screen state
      const screenshot = await connector.captureScreen();
      if (!screenshot) {
        return failure('Failed to capture screen');
      }

      const state = await understanding.analyzeScreen(screenshot);

      // Create and execute plan
      const task = {
        id: `task-${Date.now()}`,
        goal: taskDescription,
        description: taskDescription,
        category: context || 'general',
        context,
        priority: 'medium' as const,
        createdAt: Date.now(),
      };

      const plan = await planner.createPlan(task, state);
      const executedSteps: string[] = [];

      // Execute each step
      planner.startExecution();
      let currentStep = planner.getNextStep();

      while (currentStep) {
        try {
          await connector.executeAction(currentStep.action);
          executedSteps.push(currentStep.description);

          // Wait and get new state
          await sleep(500);
          const newScreenshot = await connector.captureScreen();
          const newState = newScreenshot
            ? await understanding.analyzeScreen(newScreenshot)
            : state;

          currentStep = await planner.completeCurrentStep(true, newState);
        } catch (error) {
          const newScreenshot = await connector.captureScreen();
          const newState = newScreenshot
            ? await understanding.analyzeScreen(newScreenshot)
            : state;

          currentStep = await planner.completeCurrentStep(
            false,
            newState,
            (error as Error).message
          );
        }
      }

      const finalPlan = planner.getCurrentPlan();

      return success({
        message: `Task "${taskDescription}" ${finalPlan?.status === 'completed' ? 'completed' : 'attempted'}`,
        stepsExecuted: executedSteps,
        planStatus: finalPlan?.status,
      });
    } catch (error) {
      logger.error('VM execute task failed', { error: error as Error });
      return failure((error as Error).message);
    }
  },
};

/**
 * Start recording a demonstration
 */
export const vmStartRecording: AgentTool = {
  name: 'vm_start_recording',
  description: `Start recording a demonstration for teaching Atlas a new task.
The user will perform the task, and Atlas will learn from it.`,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the demonstration',
      },
      description: {
        type: 'string',
        description: 'What task is being demonstrated',
      },
      category: {
        type: 'string',
        description: 'Category of the task (e.g., "file_management", "web_browsing", "worldbox")',
      },
    },
    required: ['name', 'description'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      if (!isVMConnectorInitialized()) {
        return failure('Not connected to any VM');
      }

      const recorder = getDemonstrationRecorder();
      const name = params.name as string;
      const description = params.description as string;
      const category = (params.category as string) || 'general';

      await recorder.startRecording(name, description, category);

      return success({
        message: `Recording started: "${name}". Perform the task now.`,
      });
    } catch (error) {
      logger.error('Start recording failed', { error: error as Error });
      return failure((error as Error).message);
    }
  },
};

/**
 * Stop recording and learn from demonstration
 */
export const vmStopRecording: AgentTool = {
  name: 'vm_stop_recording',
  description: 'Stop recording the current demonstration and save it for learning.',
  parameters: {
    type: 'object',
    properties: {
      successful: {
        type: 'boolean',
        description: 'Whether the demonstrated task was completed successfully',
      },
    },
    required: ['successful'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const recorder = getDemonstrationRecorder();
      const learner = getBehaviorLearner();
      const successful = params.successful as boolean;

      const demonstration = await recorder.stopRecording(successful);

      if (!demonstration) {
        return failure('No recording in progress');
      }

      // Try to learn from this demonstration
      const allDemos = await recorder.getDemonstrationsByCategory(demonstration.category);
      const learned = await learner.learnFromDemonstrations([...allDemos, demonstration]);

      return success({
        message: `Recorded ${demonstration.actions.length} actions`,
        demonstrationId: demonstration.id,
        learnedBehaviors: learned.length,
      });
    } catch (error) {
      logger.error('Stop recording failed', { error: error as Error });
      return failure((error as Error).message);
    }
  },
};

/**
 * Record a single action during demonstration
 */
export const vmRecordAction: AgentTool = {
  name: 'vm_record_action',
  description: 'Record an action during a demonstration. Call this after each user action.',
  parameters: {
    type: 'object',
    properties: {
      actionType: {
        type: 'string',
        enum: ['click', 'doubleClick', 'rightClick', 'type', 'keyPress', 'scroll', 'drag'],
        description: 'Type of action performed',
      },
      x: { type: 'number', description: 'X coordinate (for mouse actions)' },
      y: { type: 'number', description: 'Y coordinate (for mouse actions)' },
      text: { type: 'string', description: 'Text typed (for type action)' },
      key: { type: 'string', description: 'Key pressed (for keyPress action)' },
    },
    required: ['actionType'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const recorder = getDemonstrationRecorder();
      const actionType = params.actionType as string;
      const x = (params.x as number) || 0;
      const y = (params.y as number) || 0;

      let action: VMAction;

      switch (actionType) {
        case 'click':
          action = { type: 'click', x, y };
          break;
        case 'doubleClick':
          action = { type: 'doubleClick', x, y };
          break;
        case 'rightClick':
          action = { type: 'rightClick', x, y };
          break;
        case 'type':
          action = { type: 'type', text: (params.text as string) || '' };
          break;
        case 'keyPress':
          action = { type: 'keyPress', key: (params.key as string) || 'Enter' };
          break;
        case 'scroll':
          action = { type: 'scroll', x, y, deltaX: 0, deltaY: -100 };
          break;
        case 'drag':
          action = { type: 'drag', fromX: x, fromY: y, toX: x + 100, toY: y };
          break;
        default:
          return failure(`Unknown action type: ${actionType}`);
      }

      await recorder.recordAction(action);

      return success({
        message: `Recorded ${actionType} action`,
      });
    } catch (error) {
      logger.error('Record action failed', { error: error as Error });
      return failure((error as Error).message);
    }
  },
};

/**
 * Get learning statistics
 */
export const vmGetLearningStats: AgentTool = {
  name: 'vm_get_learning_stats',
  description: 'Get statistics about what Atlas has learned from demonstrations.',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const learner = getBehaviorLearner();
      const memory = getStrategyMemory();

      const learningStats = learner.getStats();
      const memoryStats = memory.getStats();

      return success({
        learning: learningStats,
        memory: memoryStats,
      });
    } catch (error) {
      logger.error('Get learning stats failed', { error: error as Error });
      return failure((error as Error).message);
    }
  },
};

/**
 * Check if WorldBox is running
 */
export const vmCheckWorldBox: AgentTool = {
  name: 'vm_check_worldbox',
  description: 'Check if WorldBox game is running and get its current state.',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async (): Promise<ActionResult> => {
    try {
      if (!isVMConnectorInitialized()) {
        return failure('Not connected to any VM');
      }

      const connector = getVMConnector();
      const understanding = getScreenUnderstanding();

      const screenshot = await connector.captureScreen();
      if (!screenshot) {
        return failure('Failed to capture screen');
      }

      // First analyze the screen to get ScreenState
      const screenState = await understanding.analyzeScreen(screenshot);

      // Check if WorldBox is detected
      const isWorldBox = await understanding.isWorldBox(screenState);

      if (isWorldBox) {
        const gameState = await understanding.getWorldBoxState(screenState);
        return success({
          isWorldBox: true,
          gameState,
        });
      }

      return success({
        isWorldBox: false,
        message: 'WorldBox is not currently visible',
      });
    } catch (error) {
      logger.error('WorldBox check failed', { error: error as Error });
      return failure((error as Error).message);
    }
  },
};

/**
 * Execute a WorldBox-specific command
 */
export const vmWorldBoxCommand: AgentTool = {
  name: 'vm_worldbox_command',
  description: `Execute a command in WorldBox game.
Examples: "spawn humans", "create world", "destroy with meteor", "speed up time"`,
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The WorldBox command to execute',
      },
    },
    required: ['command'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      if (!isVMConnectorInitialized()) {
        return failure('Not connected to any VM');
      }

      const connector = getVMConnector();
      const understanding = getScreenUnderstanding();
      const planner = getTaskPlanner();
      const memory = getStrategyMemory();

      const command = params.command as string;

      const screenshot = await connector.captureScreen();
      if (!screenshot) {
        return failure('Failed to capture screen');
      }

      // Get screen state
      const screenState = await understanding.analyzeScreen(screenshot);

      const isWorldBox = await understanding.isWorldBox(screenState);
      if (!isWorldBox) {
        return failure('WorldBox is not currently running');
      }

      const gameState = await understanding.getWorldBoxState(screenState);

      // Check for learned strategy
      // Get WorldBox-specific game state with full interface
      const worldBoxGameState: WorldBoxGameState = gameState ? {
        detected: true,
        currentMode: 'game',
        selectedTool: gameState.selectedTool,
        activeCategory: gameState.activeCategory,
        uiState: {
          menuOpen: gameState.menuOpen,
          settingsOpen: false,
          worldInfoVisible: false,
        },
      } : {
        detected: true,
        currentMode: 'game',
        uiState: { menuOpen: false, settingsOpen: false, worldInfoVisible: false },
      };

      const strategies = memory.getWorldBoxStrategies(command, worldBoxGameState.currentMode);

      if (strategies.length > 0) {
        const strategy = strategies[0];
        logger.info('Using WorldBox strategy', { strategy: strategy.id });

        for (const action of strategy.actions) {
          await connector.executeAction(action);
          await sleep(300);
        }

        return success({
          message: `Executed WorldBox command using learned strategy`,
          command,
          usedStrategy: strategy.goal,
        });
      }

      // Plan new approach
      const steps = await planner.planWorldBoxTask(command, worldBoxGameState);
      const executedSteps: string[] = [];
      const executedActions: VMAction[] = [];

      for (const step of steps) {
        try {
          // Find element if target specified
          if (step.targetElement) {
            const newScreenshot = await connector.captureScreen();
            if (newScreenshot) {
              const state = await understanding.analyzeScreen(newScreenshot);
              const element = await understanding.findElement(state, step.targetElement);

              if (element && (step.action.type === 'click' || step.action.type === 'doubleClick')) {
                // Update action coordinates with found element
                const updatedAction = {
                  ...step.action,
                  x: element.center.x,
                  y: element.center.y,
                } as VMAction;
                await connector.executeAction(updatedAction);
                executedActions.push(updatedAction);
              } else {
                await connector.executeAction(step.action);
                executedActions.push(step.action);
              }
            } else {
              await connector.executeAction(step.action);
              executedActions.push(step.action);
            }
          } else {
            await connector.executeAction(step.action);
            executedActions.push(step.action);
          }

          executedSteps.push(step.description);
          await sleep(400);
        } catch (error) {
          logger.warn('Step failed', { step: step.description, error });
        }
      }

      // Store successful strategy
      if (executedSteps.length > 0) {
        await memory.storeWorldBoxStrategy(command, executedActions, worldBoxGameState);
      }

      return success({
        message: `Executed WorldBox command: "${command}"`,
        stepsExecuted: executedSteps,
      });
    } catch (error) {
      logger.error('WorldBox command failed', { error: error as Error });
      return failure((error as Error).message);
    }
  },
};

/**
 * Get VM connection status
 */
export const vmGetStatus: AgentTool = {
  name: 'vm_get_status',
  description: 'Get the current VM connection status.',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async (): Promise<ActionResult> => {
    try {
      if (!isVMConnectorInitialized()) {
        return success({
          connected: false,
          message: 'No VM connection initialized',
        });
      }

      const connector = getVMConnector();
      const status = connector.getStatus();

      return success({ status });
    } catch (error) {
      return failure((error as Error).message);
    }
  },
};

// =============================================================================
// Tool Collection
// =============================================================================

/**
 * Get all VM agent tools
 */
export function getVMAgentTools(): AgentTool[] {
  return [
    vmConnect,
    vmDisconnect,
    vmScreenshot,
    vmClick,
    vmType,
    vmKeyPress,
    vmScroll,
    vmExecuteTask,
    vmStartRecording,
    vmStopRecording,
    vmRecordAction,
    vmGetLearningStats,
    vmCheckWorldBox,
    vmWorldBoxCommand,
    vmGetStatus,
  ];
}

export default {
  vmConnect,
  vmDisconnect,
  vmScreenshot,
  vmClick,
  vmType,
  vmKeyPress,
  vmScroll,
  vmExecuteTask,
  vmStartRecording,
  vmStopRecording,
  vmRecordAction,
  vmGetLearningStats,
  vmCheckWorldBox,
  vmWorldBoxCommand,
  vmGetStatus,
  getVMAgentTools,
};
