/**
 * Atlas Core IPC Handlers
 * 
 * Exposes Atlas autonomous coding agent functionality to the renderer process
 * Voice commands, task management, screen monitoring, and integrations
 */

import { ipcMain, BrowserWindow } from 'electron';
import { mainLogger } from '../utils/logger';

// Lazy imports for circular dependency avoidance
let atlasCore: typeof import('../atlas-core') | null = null;
let autonomousAgent: typeof import('../agent/autonomous-agent') | null = null;
let screenMonitor: typeof import('../agent/screen-monitor') | null = null;
let crossProjectLearning: typeof import('../memory/cross-project-learning') | null = null;
let voiceCommandHandler: typeof import('../voice/command-handler') | null = null;
let figmaIntegration: typeof import('../integrations/figma') | null = null;
let cicdMonitor: typeof import('../integrations/cicd-monitor') | null = null;
let projectManagement: typeof import('../integrations/project-management') | null = null;
let visualTesting: typeof import('../testing/visual-testing') | null = null;

async function getAtlasCore() {
  if (!atlasCore) {
    atlasCore = await import('../atlas-core');
  }
  return atlasCore;
}

async function getAutonomousAgent() {
  if (!autonomousAgent) {
    autonomousAgent = await import('../agent/autonomous-agent');
  }
  return autonomousAgent;
}

async function getScreenMonitor() {
  if (!screenMonitor) {
    screenMonitor = await import('../agent/screen-monitor');
  }
  return screenMonitor;
}

async function getCrossProjectLearning() {
  if (!crossProjectLearning) {
    crossProjectLearning = await import('../memory/cross-project-learning');
  }
  return crossProjectLearning;
}

async function getVoiceHandler() {
  if (!voiceCommandHandler) {
    voiceCommandHandler = await import('../voice/command-handler');
  }
  return voiceCommandHandler;
}

async function getFigma() {
  if (!figmaIntegration) {
    figmaIntegration = await import('../integrations/figma');
  }
  return figmaIntegration;
}

async function getCICD() {
  if (!cicdMonitor) {
    cicdMonitor = await import('../integrations/cicd-monitor');
  }
  return cicdMonitor;
}

async function getProjectManagement() {
  if (!projectManagement) {
    projectManagement = await import('../integrations/project-management');
  }
  return projectManagement;
}

async function getVisualTesting() {
  if (!visualTesting) {
    visualTesting = await import('../testing/visual-testing');
  }
  return visualTesting;
}

/**
 * Register all Atlas IPC handlers
 */
export function registerAtlasHandlers(): void {
  mainLogger.info('Registering Atlas IPC handlers');

  // ==========================================
  // Atlas Core Control
  // ==========================================

  ipcMain.handle('atlas:core:getStatus', async () => {
    try {
      const core = await getAtlasCore();
      const atlas = core.getAtlasCore();
      if (!atlas) {
        return { success: false, error: 'Atlas not initialized' };
      }
      return { success: true, data: atlas.getStatus() };
    } catch (error) {
      mainLogger.error('atlas:core:getStatus error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:core:shutdown', async () => {
    try {
      const core = await getAtlasCore();
      const atlas = core.getAtlasCore();
      if (!atlas) {
        return { success: false, error: 'Atlas not initialized' };
      }
      await atlas.shutdown();
      return { success: true };
    } catch (error) {
      mainLogger.error('atlas:core:shutdown error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // ==========================================
  // Autonomous Agent
  // ==========================================

  ipcMain.handle('atlas:agent:executeTask', async (_, task: string) => {
    try {
      const agent = await getAutonomousAgent();
      const autonomous = agent.getAutonomousAgent();
      if (!autonomous) {
        return { success: false, error: 'Autonomous agent not initialized' };
      }
      const result = await autonomous.executeTask(task);
      return { success: true, data: result };
    } catch (error) {
      mainLogger.error('atlas:agent:executeTask error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:agent:setAutonomyLevel', async (_, level: 'supervised' | 'trusted' | 'autonomous') => {
    try {
      const agent = await getAutonomousAgent();
      const autonomous = agent.getAutonomousAgent();
      if (!autonomous) {
        return { success: false, error: 'Autonomous agent not initialized' };
      }
      autonomous.setAutonomyLevel(level);
      return { success: true };
    } catch (error) {
      mainLogger.error('atlas:agent:setAutonomyLevel error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:agent:getStatus', async () => {
    try {
      const agent = await getAutonomousAgent();
      const autonomous = agent.getAutonomousAgent();
      if (!autonomous) {
        return { success: false, error: 'Autonomous agent not initialized' };
      }
      return { success: true, data: autonomous.getStatus() };
    } catch (error) {
      mainLogger.error('atlas:agent:getStatus error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:agent:rollback', async (_, steps?: number) => {
    try {
      const agent = await getAutonomousAgent();
      const autonomous = agent.getAutonomousAgent();
      if (!autonomous) {
        return { success: false, error: 'Autonomous agent not initialized' };
      }
      const result = await autonomous.rollback(steps);
      return { success: true, data: result };
    } catch (error) {
      mainLogger.error('atlas:agent:rollback error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:agent:answerQuestion', async (_, answer: string) => {
    try {
      const agent = await getAutonomousAgent();
      const autonomous = agent.getAutonomousAgent();
      if (!autonomous) {
        return { success: false, error: 'Autonomous agent not initialized' };
      }
      autonomous.answerQuestion(answer);
      return { success: true };
    } catch (error) {
      mainLogger.error('atlas:agent:answerQuestion error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:agent:cancelTask', async () => {
    try {
      const agent = await getAutonomousAgent();
      const autonomous = agent.getAutonomousAgent();
      if (!autonomous) {
        return { success: false, error: 'Autonomous agent not initialized' };
      }
      autonomous.cancelCurrentTask();
      return { success: true };
    } catch (error) {
      mainLogger.error('atlas:agent:cancelTask error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // ==========================================
  // Screen Monitoring
  // ==========================================

  ipcMain.handle('atlas:screen:start', async () => {
    try {
      const monitor = await getScreenMonitor();
      const screenMon = monitor.getScreenMonitor();
      if (!screenMon) {
        return { success: false, error: 'Screen monitor not initialized' };
      }
      await screenMon.start();
      return { success: true };
    } catch (error) {
      mainLogger.error('atlas:screen:start error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:screen:stop', async () => {
    try {
      const monitor = await getScreenMonitor();
      const screenMon = monitor.getScreenMonitor();
      if (!screenMon) {
        return { success: false, error: 'Screen monitor not initialized' };
      }
      await screenMon.stop();
      return { success: true };
    } catch (error) {
      mainLogger.error('atlas:screen:stop error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:screen:getErrors', async () => {
    try {
      const monitor = await getScreenMonitor();
      const screenMon = monitor.getScreenMonitor();
      if (!screenMon) {
        return { success: false, error: 'Screen monitor not initialized' };
      }
      return { success: true, data: screenMon.getDetectedErrors() };
    } catch (error) {
      mainLogger.error('atlas:screen:getErrors error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:screen:manualCheck', async () => {
    try {
      const monitor = await getScreenMonitor();
      const screenMon = monitor.getScreenMonitor();
      if (!screenMon) {
        return { success: false, error: 'Screen monitor not initialized' };
      }
      const errors = await screenMon.manualCheck();
      return { success: true, data: errors };
    } catch (error) {
      mainLogger.error('atlas:screen:manualCheck error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:screen:pause', async () => {
    try {
      const monitor = await getScreenMonitor();
      const screenMon = monitor.getScreenMonitor();
      if (!screenMon) {
        return { success: false, error: 'Screen monitor not initialized' };
      }
      screenMon.pause();
      return { success: true };
    } catch (error) {
      mainLogger.error('atlas:screen:pause error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:screen:resume', async () => {
    try {
      const monitor = await getScreenMonitor();
      const screenMon = monitor.getScreenMonitor();
      if (!screenMon) {
        return { success: false, error: 'Screen monitor not initialized' };
      }
      screenMon.resume();
      return { success: true };
    } catch (error) {
      mainLogger.error('atlas:screen:resume error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:screen:getStatus', async () => {
    try {
      const monitor = await getScreenMonitor();
      const screenMon = monitor.getScreenMonitor();
      if (!screenMon) {
        return { success: false, error: 'Screen monitor not initialized' };
      }
      return { success: true, data: screenMon.getStatus() };
    } catch (error) {
      mainLogger.error('atlas:screen:getStatus error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // ==========================================
  // Cross-Project Learning
  // ==========================================

  ipcMain.handle('atlas:learning:findSolutions', async (_, problem: string) => {
    try {
      const learning = await getCrossProjectLearning();
      const learningDb = await learning.getCrossProjectLearning();
      if (!learningDb) {
        return { success: false, error: 'Cross-project learning not initialized' };
      }
      const solutions = learningDb.findSolution(problem);
      return { success: true, data: solutions };
    } catch (error) {
      mainLogger.error('atlas:learning:findSolutions error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:learning:findPatterns', async (_, query: string, options?: {
    limit?: number;
    category?: 'component' | 'hook' | 'api' | 'utility' | 'config' | 'test' | 'error-handling' | 'data-fetching' | 'state-management' | 'authentication' | 'styling' | 'animation' | 'other';
    language?: string;
    minQuality?: number;
  }) => {
    try {
      const learning = await getCrossProjectLearning();
      const learningDb = await learning.getCrossProjectLearning();
      if (!learningDb) {
        return { success: false, error: 'Cross-project learning not initialized' };
      }
      const patterns = learningDb.findSimilarPatterns(query, options);
      return { success: true, data: patterns };
    } catch (error) {
      mainLogger.error('atlas:learning:findPatterns error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:learning:learnPattern', async (_, pattern: {
    name: string;
    description: string;
    code: string;
    language: string;
    category?: string;
    framework?: string;
    projects?: string[];
    usage?: { timesUsed: number; timesModified: number; timesSuggested: number; timesAccepted: number };
  }) => {
    try {
      const learning = await getCrossProjectLearning();
      const learningDb = await learning.getCrossProjectLearning();
      if (!learningDb) {
        return { success: false, error: 'Cross-project learning not initialized' };
      }
      const learned = learningDb.learnPattern({
        name: pattern.name,
        description: pattern.description,
        category: (pattern.category || 'other') as any,
        code: pattern.code,
        language: pattern.language,
        framework: pattern.framework,
        projects: pattern.projects || [],
        usage: pattern.usage || { timesUsed: 0, timesModified: 0, timesSuggested: 0, timesAccepted: 0 },
      });
      return { success: true, data: learned };
    } catch (error) {
      mainLogger.error('atlas:learning:learnPattern error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:learning:learnSolution', async (_, solution: {
    problem: string;
    solution: string;
    solutionType?: 'code' | 'command' | 'config' | 'explanation';
    category?: string;
    projects?: string[];
    successRate?: number;
    timesApplied?: number;
  }) => {
    try {
      const learning = await getCrossProjectLearning();
      const learningDb = await learning.getCrossProjectLearning();
      if (!learningDb) {
        return { success: false, error: 'Cross-project learning not initialized' };
      }
      const learned = learningDb.learnSolution({
        problem: solution.problem,
        solution: solution.solution,
        solutionType: solution.solutionType || 'code',
        category: solution.category || 'general',
        projects: solution.projects || [],
        successRate: solution.successRate || 1,
        timesApplied: solution.timesApplied || 0,
      });
      return { success: true, data: learned };
    } catch (error) {
      mainLogger.error('atlas:learning:learnSolution error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:learning:getStylePreferences', async (_, category?: string) => {
    try {
      const learning = await getCrossProjectLearning();
      const learningDb = await learning.getCrossProjectLearning();
      if (!learningDb) {
        return { success: false, error: 'Cross-project learning not initialized' };
      }
      const prefs = learningDb.getStylePreferences(category);
      return { success: true, data: prefs };
    } catch (error) {
      mainLogger.error('atlas:learning:getStylePreferences error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // ==========================================
  // Voice Commands
  // ==========================================

  ipcMain.handle('atlas:voice:process', async (_, transcript: string) => {
    try {
      const handler = await getVoiceHandler();
      const voiceHandler = handler.getVoiceCommandHandler();
      if (!voiceHandler) {
        return { success: false, error: 'Voice command handler not initialized' };
      }
      const result = await voiceHandler.processCommand(transcript);
      return { success: true, data: result };
    } catch (error) {
      mainLogger.error('atlas:voice:process error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:voice:getContext', async () => {
    try {
      const handler = await getVoiceHandler();
      const voiceHandler = handler.getVoiceCommandHandler();
      if (!voiceHandler) {
        return { success: false, error: 'Voice command handler not initialized' };
      }
      return { success: true, data: voiceHandler.getContext() };
    } catch (error) {
      mainLogger.error('atlas:voice:getContext error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // ==========================================
  // Personality & Voice Mode
  // ==========================================

  ipcMain.handle('atlas:personality:getConfig', async () => {
    try {
      const { getPersonalityManager } = await import('../agent/personality-manager');
      const personality = getPersonalityManager();
      return { 
        success: true, 
        data: {
          preset: personality.getPreset(),
          voiceMode: personality.getVoiceMode(),
          traits: personality.getTraits(),
          effectiveTraits: personality.getEffectiveTraits(),
          conversationState: personality.getConversationState(),
        }
      };
    } catch (error) {
      mainLogger.error('atlas:personality:getConfig error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:personality:setPreset', async (_, preset: string) => {
    try {
      const { getPersonalityManager } = await import('../agent/personality-manager');
      const personality = getPersonalityManager();
      personality.setPreset(preset as any);
      return { success: true, data: { preset: personality.getPreset() } };
    } catch (error) {
      mainLogger.error('atlas:personality:setPreset error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:personality:setVoiceMode', async (_, mode: string) => {
    try {
      const { getPersonalityManager } = await import('../agent/personality-manager');
      const personality = getPersonalityManager();
      personality.setVoiceMode(mode as any);
      return { 
        success: true, 
        data: { 
          voiceMode: personality.getVoiceMode(),
          effectiveTraits: personality.getEffectiveTraits(),
        } 
      };
    } catch (error) {
      mainLogger.error('atlas:personality:setVoiceMode error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:personality:setTrait', async (_, trait: string, value: number) => {
    try {
      const { getPersonalityManager } = await import('../agent/personality-manager');
      const personality = getPersonalityManager();
      personality.setTrait(trait as any, value);
      return { success: true, data: { traits: personality.getTraits() } };
    } catch (error) {
      mainLogger.error('atlas:personality:setTrait error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:personality:getGreeting', async () => {
    try {
      const { getPersonalityManager } = await import('../agent/personality-manager');
      const personality = getPersonalityManager();
      return { success: true, data: personality.getGreeting() };
    } catch (error) {
      mainLogger.error('atlas:personality:getGreeting error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:personality:getContextualResponse', async (_, phase: string) => {
    try {
      const { getPersonalityManager } = await import('../agent/personality-manager');
      const personality = getPersonalityManager();
      const response = personality.getContextualResponse(phase as any);
      return { success: true, data: response };
    } catch (error) {
      mainLogger.error('atlas:personality:getContextualResponse error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:personality:checkWellness', async () => {
    try {
      const { getPersonalityManager } = await import('../agent/personality-manager');
      const personality = getPersonalityManager();
      const reminder = personality.checkWellness();
      return { success: true, data: reminder };
    } catch (error) {
      mainLogger.error('atlas:personality:checkWellness error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:personality:setContext', async (_, context: string) => {
    try {
      const { getPersonalityManager } = await import('../agent/personality-manager');
      const personality = getPersonalityManager();
      personality.setContext(context as any);
      return { success: true, data: { context: personality.getConversationState().context } };
    } catch (error) {
      mainLogger.error('atlas:personality:setContext error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:personality:detectContext', async (_, text: string) => {
    try {
      const { getPersonalityManager } = await import('../agent/personality-manager');
      const personality = getPersonalityManager();
      const context = personality.detectContext(text);
      personality.setContext(context);
      return { success: true, data: { context } };
    } catch (error) {
      mainLogger.error('atlas:personality:detectContext error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:personality:recordSuccess', async () => {
    try {
      const { getPersonalityManager } = await import('../agent/personality-manager');
      const personality = getPersonalityManager();
      personality.recordSuccess();
      return { success: true, data: personality.getConversationState() };
    } catch (error) {
      mainLogger.error('atlas:personality:recordSuccess error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:personality:recordFailure', async () => {
    try {
      const { getPersonalityManager } = await import('../agent/personality-manager');
      const personality = getPersonalityManager();
      personality.recordFailure();
      return { success: true, data: personality.getConversationState() };
    } catch (error) {
      mainLogger.error('atlas:personality:recordFailure error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // ==========================================
  // Figma Integration
  // ==========================================

  ipcMain.handle('atlas:figma:importFile', async (_, fileKey: string) => {
    try {
      const figma = await getFigma();
      const figmaInt = figma.getFigmaIntegration();
      if (!figmaInt) {
        return { success: false, error: 'Figma integration not initialized' };
      }
      const result = await figmaInt.importFile(fileKey);
      return { success: true, data: result };
    } catch (error) {
      mainLogger.error('atlas:figma:importFile error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:figma:importComponent', async (_, fileKey: string, nodeId: string) => {
    try {
      const figma = await getFigma();
      const figmaInt = figma.getFigmaIntegration();
      if (!figmaInt) {
        return { success: false, error: 'Figma integration not initialized' };
      }
      const result = await figmaInt.importComponent(fileKey, nodeId);
      return { success: true, data: result };
    } catch (error) {
      mainLogger.error('atlas:figma:importComponent error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:figma:syncTokens', async (_, fileKey: string) => {
    try {
      const figma = await getFigma();
      const figmaInt = figma.getFigmaIntegration();
      if (!figmaInt) {
        return { success: false, error: 'Figma integration not initialized' };
      }
      const tokens = await figmaInt.syncDesignTokens(fileKey);
      return { success: true, data: tokens };
    } catch (error) {
      mainLogger.error('atlas:figma:syncTokens error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // ==========================================
  // CI/CD Monitoring
  // ==========================================

  ipcMain.handle('atlas:cicd:startAll', async () => {
    try {
      const cicd = await getCICD();
      const monitor = cicd.getCICDMonitor();
      if (!monitor) {
        return { success: false, error: 'CI/CD monitor not initialized' };
      }
      monitor.startAll();
      return { success: true };
    } catch (error) {
      mainLogger.error('atlas:cicd:startAll error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:cicd:stopAll', async () => {
    try {
      const cicd = await getCICD();
      const monitor = cicd.getCICDMonitor();
      if (!monitor) {
        return { success: false, error: 'CI/CD monitor not initialized' };
      }
      monitor.stopAll();
      return { success: true };
    } catch (error) {
      mainLogger.error('atlas:cicd:stopAll error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:cicd:getStatus', async () => {
    try {
      const cicd = await getCICD();
      const monitor = cicd.getCICDMonitor();
      if (!monitor) {
        return { success: false, error: 'CI/CD monitor not initialized' };
      }
      return { success: true, data: monitor.getStatus() };
    } catch (error) {
      mainLogger.error('atlas:cicd:getStatus error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:cicd:getPipelines', async () => {
    try {
      const cicd = await getCICD();
      const monitor = cicd.getCICDMonitor();
      if (!monitor) {
        return { success: false, error: 'CI/CD monitor not initialized' };
      }
      return { success: true, data: monitor.getPipelines() };
    } catch (error) {
      mainLogger.error('atlas:cicd:getPipelines error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:cicd:getFailures', async () => {
    try {
      const cicd = await getCICD();
      const monitor = cicd.getCICDMonitor();
      if (!monitor) {
        return { success: false, error: 'CI/CD monitor not initialized' };
      }
      return { success: true, data: monitor.getFailures() };
    } catch (error) {
      mainLogger.error('atlas:cicd:getFailures error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:cicd:triggerRebuild', async (_, pipelineId: string) => {
    try {
      const cicd = await getCICD();
      const monitor = cicd.getCICDMonitor();
      if (!monitor) {
        return { success: false, error: 'CI/CD monitor not initialized' };
      }
      await monitor.triggerRebuild(pipelineId);
      return { success: true };
    } catch (error) {
      mainLogger.error('atlas:cicd:triggerRebuild error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // ==========================================
  // Project Management (Jira/Linear)
  // ==========================================

  ipcMain.handle('atlas:pm:getIssues', async (_, params?: {
    status?: Array<'todo' | 'in-progress' | 'in-review' | 'done' | 'cancelled'>;
    priority?: Array<'urgent' | 'high' | 'medium' | 'low' | 'none'>;
    assignee?: string;
    limit?: number;
  }) => {
    try {
      const pm = await getProjectManagement();
      const pmInstance = pm.getProjectManagement();
      if (!pmInstance) {
        return { success: false, error: 'Project management not initialized' };
      }
      const issues = await pmInstance.getIssues(params);
      return { success: true, data: issues };
    } catch (error) {
      mainLogger.error('atlas:pm:getIssues error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:pm:createIssue', async (_, issue: {
    title: string;
    description?: string;
    priority?: 'urgent' | 'high' | 'medium' | 'low' | 'none';
    labels?: string[];
  }) => {
    try {
      const pm = await getProjectManagement();
      const pmInstance = pm.getProjectManagement();
      if (!pmInstance) {
        return { success: false, error: 'Project management not initialized' };
      }
      const created = await pmInstance.createIssue(issue);
      return { success: true, data: created };
    } catch (error) {
      mainLogger.error('atlas:pm:createIssue error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:pm:updateStatus', async (_, issueKey: string, status: 'todo' | 'in-progress' | 'in-review' | 'done' | 'cancelled') => {
    try {
      const pm = await getProjectManagement();
      const pmInstance = pm.getProjectManagement();
      if (!pmInstance) {
        return { success: false, error: 'Project management not initialized' };
      }
      await pmInstance.updateStatus(issueKey, status);
      return { success: true };
    } catch (error) {
      mainLogger.error('atlas:pm:updateStatus error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:pm:addComment', async (_, issueKey: string, body: string) => {
    try {
      const pm = await getProjectManagement();
      const pmInstance = pm.getProjectManagement();
      if (!pmInstance) {
        return { success: false, error: 'Project management not initialized' };
      }
      await pmInstance.addComment(issueKey, body);
      return { success: true };
    } catch (error) {
      mainLogger.error('atlas:pm:addComment error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:pm:getMyIssues', async () => {
    try {
      const pm = await getProjectManagement();
      const pmInstance = pm.getProjectManagement();
      if (!pmInstance) {
        return { success: false, error: 'Project management not initialized' };
      }
      const issues = await pmInstance.getMyIssues();
      return { success: true, data: issues };
    } catch (error) {
      mainLogger.error('atlas:pm:getMyIssues error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // ==========================================
  // Visual Testing
  // ==========================================

  ipcMain.handle('atlas:visual:runTest', async (_, test: {
    name: string;
    component?: string;
    url?: string;
    selector?: string;
    viewport?: { width: number; height: number; name: string };
  }) => {
    try {
      const vt = await getVisualTesting();
      const runner = vt.getVisualTestRunner();
      if (!runner) {
        return { success: false, error: 'Visual test runner not initialized' };
      }
      const result = await runner.runTest({
        id: `test_${Date.now()}`,
        name: test.name,
        component: test.component || test.name,
        url: test.url,
        selector: test.selector,
        viewport: test.viewport || { width: 1920, height: 1080, name: 'desktop' },
        status: 'pending',
      });
      return { success: true, data: result };
    } catch (error) {
      mainLogger.error('atlas:visual:runTest error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:visual:runSuite', async (_, tests: Array<{
    name: string;
    component?: string;
    url?: string;
    selector?: string;
    viewport?: { width: number; height: number; name: string };
  }>) => {
    try {
      const vt = await getVisualTesting();
      const runner = vt.getVisualTestRunner();
      if (!runner) {
        return { success: false, error: 'Visual test runner not initialized' };
      }
      const normalizedTests = tests.map((t, i) => ({
        id: `test_${Date.now()}_${i}`,
        name: t.name,
        component: t.component || t.name,
        url: t.url,
        selector: t.selector,
        viewport: t.viewport || { width: 1920, height: 1080, name: 'desktop' },
        status: 'pending' as const,
      }));
      const result = await runner.runSuite(normalizedTests);
      return { success: true, data: result };
    } catch (error) {
      mainLogger.error('atlas:visual:runSuite error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:visual:updateBaseline', async (_, test: {
    name: string;
    component?: string;
    url?: string;
    selector?: string;
    viewport?: { width: number; height: number; name: string };
  }) => {
    try {
      const vt = await getVisualTesting();
      const runner = vt.getVisualTestRunner();
      if (!runner) {
        return { success: false, error: 'Visual test runner not initialized' };
      }
      await runner.updateBaseline({
        id: `test_${Date.now()}`,
        name: test.name,
        component: test.component || test.name,
        url: test.url,
        selector: test.selector,
        viewport: test.viewport || { width: 1920, height: 1080, name: 'desktop' },
        status: 'pending',
      });
      return { success: true };
    } catch (error) {
      mainLogger.error('atlas:visual:updateBaseline error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('atlas:visual:getConfig', async () => {
    try {
      const vt = await getVisualTesting();
      const runner = vt.getVisualTestRunner();
      if (!runner) {
        return { success: false, error: 'Visual test runner not initialized' };
      }
      return { success: true, data: runner.getConfig() };
    } catch (error) {
      mainLogger.error('atlas:visual:getConfig error', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  mainLogger.info('Atlas IPC handlers registered successfully');
}

/**
 * Forward Atlas events to a specific window
 */
export function forwardAtlasEvents(window: BrowserWindow): void {
  getAtlasCore().then((core) => {
    const atlas = core.getAtlasCore();
    if (!atlas) return;

    atlas.on('taskStarted', (task) => {
      if (!window.isDestroyed()) {
        window.webContents.send('atlas:task-started', task);
      }
    });

    atlas.on('taskCompleted', (task) => {
      if (!window.isDestroyed()) {
        window.webContents.send('atlas:task-completed', task);
      }
    });

    atlas.on('errorDetected', (error) => {
      if (!window.isDestroyed()) {
        window.webContents.send('atlas:error-detected', error);
      }
    });

    atlas.on('autoCommit', (record) => {
      if (!window.isDestroyed()) {
        window.webContents.send('atlas:auto-commit', record);
      }
    });

    atlas.on('buildFailure', (failure) => {
      if (!window.isDestroyed()) {
        window.webContents.send('atlas:build-failure', failure);
      }
    });

    atlas.on('voiceCommand', (cmd) => {
      if (!window.isDestroyed()) {
        window.webContents.send('atlas:voice-command', cmd);
      }
    });
  }).catch((error) => {
    mainLogger.error('Failed to forward Atlas events', { error: (error as Error).message });
  });
}
