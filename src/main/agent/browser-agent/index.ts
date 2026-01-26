/**
 * Browser Agent Module
 *
 * Advanced browser automation system that surpasses Claude for Chrome and Google Antigravity.
 * Features hybrid DOM + Vision understanding, Set-of-Mark visual prompting, human-like stealth mode,
 * intelligent recovery, multi-tab orchestration, and persistent sessions.
 *
 * @module agent/browser-agent
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';

// Export types
export * from './types';

// Export core components
export { DOMSerializer, createDOMSerializer } from './dom-serializer';
export { SetOfMarkManager, createSetOfMarkManager, MARKER_STYLE_PRESETS } from './set-of-mark';
export { BrowserAgentOrchestrator, createBrowserAgentOrchestrator } from './orchestrator';
export { SessionManager, getSessionManager } from './session-manager';
export { StealthModeManager, createStealthModeManager, generateHumanMousePath, generateTypingDelays, generateScrollPattern } from './stealth';
export { RecoverySystem, createRecoverySystem, withRetry, waitForCondition, DEFAULT_RECOVERY_STRATEGIES } from './recovery';
export { ElementGrounding, createElementGrounding } from './element-grounding';
export { MultiTabManager, createMultiTabManager } from './multi-tab';

// Export advanced differentiating modules
export { PredictiveEngine, getPredictiveEngine, createPredictiveEngine } from './predictive-engine';
export { VisualMemory, getVisualMemory, createVisualMemory } from './visual-memory';
export { SelfHealingSelectors, createSelfHealingSelectors } from './self-healing-selectors';
export { ActionCompositor, createActionCompositor, COMMON_COMPOSITES } from './action-compositor';
export { WebsiteKnowledgeBase, getWebsiteKnowledgeBase, createWebsiteKnowledgeBase } from './website-knowledge';
export { IntelligentFormHandler, getIntelligentFormHandler, createIntelligentFormHandler } from './intelligent-form';
export { ParallelSpeculationEngine, getParallelSpeculationEngine, createParallelSpeculationEngine } from './parallel-speculation';
export { NaturalLanguageEngine, getNaturalLanguageEngine, createNaturalLanguageEngine } from './natural-language';
export { ContextFusionEngine, getContextFusionEngine, createContextFusionEngine } from './context-fusion';

// Import for composite classes
import { BrowserAgentOrchestrator, createBrowserAgentOrchestrator } from './orchestrator';
import { MultiTabManager, createMultiTabManager } from './multi-tab';
import { SessionManager, getSessionManager } from './session-manager';
import { createStealthModeManager, StealthModeManager } from './stealth';
import {
  BrowserTask,
  TaskResult,
  StealthConfig,
  BrowserAgentConfig,
  DEFAULT_AGENT_CONFIG,
} from './types';

const logger = createModuleLogger('BrowserAgent');

// ============================================================================
// Main Browser Agent Class
// ============================================================================

/**
 * BrowserAgent - The main entry point for browser automation
 *
 * This class combines all browser agent capabilities into a single interface:
 * - Task execution with planning and validation
 * - Multi-tab management
 * - Session persistence
 * - Stealth mode
 * - Error recovery
 */
export class BrowserAgent extends EventEmitter {
  private browser: any = null;
  private orchestrator: BrowserAgentOrchestrator | null = null;
  private tabManager: MultiTabManager | null = null;
  private sessionManager: SessionManager;
  private stealthManagers: Map<string, StealthModeManager> = new Map();
  private config: BrowserAgentConfig;
  private isInitialized = false;
  private activeProfile: string | null = null;

  constructor(config?: Partial<BrowserAgentConfig>) {
    super();
    this.config = { ...DEFAULT_AGENT_CONFIG, ...config };
    this.sessionManager = getSessionManager();
  }

  /**
   * Initialize the browser agent
   */
  async initialize(options?: {
    browser?: any;
    profileName?: string;
    stealthMode?: boolean;
  }): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Browser agent already initialized');
      return;
    }

    logger.info('Initializing browser agent');

    // Use provided browser or launch new one
    if (options?.browser) {
      this.browser = options.browser;
    } else {
      // Launch browser with debugging
      const puppeteer = await import('puppeteer-core');
      this.browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: [
          '--remote-debugging-port=9222',
          '--no-first-run',
          '--no-default-browser-check',
          ...(options?.stealthMode
            ? [
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
              ]
            : []),
        ],
      });
    }

    // Initialize tab manager
    this.tabManager = await createMultiTabManager(this.browser, {
      maxTabs: this.config.maxTabs || 10,
    });

    // Get the first page
    const pages = await this.browser.pages();
    const page = pages[0];

    // Apply stealth mode if enabled
    if (this.config.stealthMode?.enabled || options?.stealthMode) {
      const stealthManager = createStealthModeManager(page, this.config.stealthMode);
      await stealthManager.apply();
      this.stealthManagers.set('main', stealthManager);
    }

    // Initialize orchestrator with the first page
    this.orchestrator = createBrowserAgentOrchestrator(page, this.config);

    // Set up event forwarding
    this.setupEventForwarding();

    // Load profile if specified
    if (options?.profileName) {
      await this.loadProfile(options.profileName);
    }

    this.isInitialized = true;
    this.emit('initialized');
    logger.info('Browser agent initialized successfully');
  }

  /**
   * Execute a browser task
   */
  async executeTask(task: BrowserTask): Promise<TaskResult> {
    if (!this.isInitialized || !this.orchestrator) {
      throw new Error('Browser agent not initialized');
    }

    logger.info('Executing task', { taskId: task.id, goal: task.goal });
    this.emit('task-started', task);

    const result = await this.orchestrator.executeTask(task);

    this.emit('task-completed', { task, result });
    return result;
  }

  /**
   * Execute a simple action without full task planning
   */
  async executeAction(
    action: string,
    params?: Record<string, any>
  ): Promise<any> {
    if (!this.isInitialized || !this.orchestrator) {
      throw new Error('Browser agent not initialized');
    }

    // Create a simple task
    const task: BrowserTask = {
      id: `action_${Date.now()}`,
      goal: action,
      startUrl: params?.url,
      maxSteps: params?.maxSteps || 5,
    };

    const result = await this.executeTask(task);
    return result.success ? result.extractedData : { error: result.error };
  }

  /**
   * Navigate to a URL
   */
  async navigate(url: string): Promise<void> {
    if (!this.orchestrator) throw new Error('Not initialized');
    await this.orchestrator.navigate(url);
  }

  /**
   * Click on an element by description
   */
  async click(description: string): Promise<boolean> {
    return this.executeAction(`Click on ${description}`);
  }

  /**
   * Type text into an element
   */
  async type(text: string, description?: string): Promise<boolean> {
    const action = description
      ? `Type "${text}" into ${description}`
      : `Type "${text}"`;
    return this.executeAction(action);
  }

  /**
   * Extract data from the current page
   */
  async extract(query: string): Promise<any> {
    return this.executeAction(`Extract: ${query}`);
  }

  // ============================================================================
  // Multi-Tab Operations
  // ============================================================================

  /**
   * Create a new tab
   */
  async createTab(options?: {
    url?: string;
    purpose?: string;
    group?: string;
  }): Promise<string> {
    if (!this.tabManager) throw new Error('Not initialized');
    const tab = await this.tabManager.createTab(options);
    return tab.id;
  }

  /**
   * Switch to a different tab
   */
  async switchTab(tabId: string): Promise<void> {
    if (!this.tabManager) throw new Error('Not initialized');
    await this.tabManager.switchToTab(tabId);

    // Update orchestrator to use the new tab's page
    const page = this.tabManager.getPage(tabId);
    if (page && this.orchestrator) {
      this.orchestrator = createBrowserAgentOrchestrator(page, this.config);
    }
  }

  /**
   * Close a tab
   */
  async closeTab(tabId: string): Promise<void> {
    if (!this.tabManager) throw new Error('Not initialized');
    await this.tabManager.closeTab(tabId);
  }

  /**
   * Get all open tabs
   */
  getTabs(): Array<{ id: string; url: string; title: string; active: boolean }> {
    if (!this.tabManager) return [];
    return this.tabManager.getTabs();
  }

  /**
   * Execute actions in parallel across tabs
   */
  async parallelExecute(
    actions: Array<{ tabId: string; action: string }>
  ): Promise<Map<string, any>> {
    if (!this.tabManager) throw new Error('Not initialized');

    const tabActions = actions.map((a) => ({
      type: 'custom' as const,
      tabId: a.tabId,
      payload: { script: a.action },
    }));

    const results = await this.tabManager.executeParallel(tabActions);

    const resultMap = new Map<string, any>();
    for (const result of results) {
      resultMap.set(result.tabId, result.success ? result.result : { error: result.error });
    }

    return resultMap;
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Save the current session to a profile
   */
  async saveProfile(name: string): Promise<void> {
    if (!this.orchestrator) throw new Error('Not initialized');

    const page = await this.browser.pages().then((p: any[]) => p[0]);
    await this.sessionManager.captureSessionState(name, page);
    this.activeProfile = name;

    logger.info('Profile saved', { name });
  }

  /**
   * Load a profile and restore session state
   */
  async loadProfile(name: string): Promise<boolean> {
    const profile = this.sessionManager.getProfile(name);
    if (!profile) {
      logger.warn('Profile not found', { name });
      return false;
    }

    const page = await this.browser.pages().then((p: any[]) => p[0]);
    await this.sessionManager.restoreProfileState(profile, page);
    this.activeProfile = name;

    logger.info('Profile loaded', { name });
    return true;
  }

  /**
   * List all saved profiles
   */
  getProfiles(): string[] {
    return this.sessionManager.listProfiles();
  }

  /**
   * Delete a profile
   */
  deleteProfile(name: string): boolean {
    return this.sessionManager.deleteProfile(name);
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Update configuration
   */
  updateConfig(config: Partial<BrowserAgentConfig>): void {
    this.config = { ...this.config, ...config };

    if (this.orchestrator) {
      this.orchestrator.updateConfig(config);
    }
  }

  /**
   * Enable or disable stealth mode
   */
  async setStealthMode(enabled: boolean, config?: Partial<StealthConfig>): Promise<void> {
    this.config.stealthMode = {
      ...this.config.stealthMode,
      enabled,
      ...config,
    };

    if (enabled) {
      const page = await this.browser.pages().then((p: any[]) => p[0]);
      const stealthManager = createStealthModeManager(page, this.config.stealthMode);
      await stealthManager.apply();
      this.stealthManagers.set('main', stealthManager);
    }
  }

  /**
   * Set whether to require confirmation for actions
   */
  setRequireConfirmation(require: boolean): void {
    this.config.requireConfirmation = require;
    if (this.orchestrator) {
      this.orchestrator.updateConfig({ requireConfirmation: require });
    }
  }

  // ============================================================================
  // Event Handling
  // ============================================================================

  /**
   * Set up event forwarding from sub-components
   */
  private setupEventForwarding(): void {
    if (this.orchestrator) {
      this.orchestrator.on('step-started', (data) => this.emit('step-started', data));
      this.orchestrator.on('step-completed', (data) => this.emit('step-completed', data));
      this.orchestrator.on('confirmation-needed', (data) => this.emit('confirmation-needed', data));
      this.orchestrator.on('error', (data) => this.emit('error', data));
      this.orchestrator.on('recovery-attempted', (data) => this.emit('recovery-attempted', data));
    }

    if (this.tabManager) {
      this.tabManager.on('tab-created', (data) => this.emit('tab-created', data));
      this.tabManager.on('tab-closed', (data) => this.emit('tab-closed', data));
      this.tabManager.on('tab-switched', (data) => this.emit('tab-switched', data));
    }
  }

  /**
   * Set confirmation callback for requiring user approval
   */
  setConfirmationCallback(
    callback: (action: string, context: any) => Promise<boolean>
  ): void {
    if (this.orchestrator) {
      this.orchestrator.setConfirmationCallback(callback);
    }
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Close the browser and clean up resources
   */
  async close(): Promise<void> {
    logger.info('Closing browser agent');

    // Save session if profile is active
    if (this.activeProfile) {
      try {
        await this.saveProfile(this.activeProfile);
      } catch (e) {
        logger.warn('Failed to save profile on close', e);
      }
    }

    // Close tab manager
    if (this.tabManager) {
      await this.tabManager.dispose();
      this.tabManager = null;
    }

    // Close browser
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    this.orchestrator = null;
    this.stealthManagers.clear();
    this.isInitialized = false;

    this.emit('closed');
    this.removeAllListeners();
  }

  /**
   * Check if the agent is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Get current status
   */
  getStatus(): {
    initialized: boolean;
    tabCount: number;
    activeProfile: string | null;
    stealthMode: boolean;
  } {
    return {
      initialized: this.isInitialized,
      tabCount: this.tabManager?.getTabs().length || 0,
      activeProfile: this.activeProfile,
      stealthMode: this.config.stealthMode?.enabled || false,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let browserAgentInstance: BrowserAgent | null = null;

/**
 * Get the singleton browser agent instance
 */
export function getBrowserAgent(config?: Partial<BrowserAgentConfig>): BrowserAgent {
  if (!browserAgentInstance) {
    browserAgentInstance = new BrowserAgent(config);
  }
  return browserAgentInstance;
}

/**
 * Reset the singleton browser agent instance
 */
export async function resetBrowserAgent(): Promise<void> {
  if (browserAgentInstance) {
    await browserAgentInstance.close();
    browserAgentInstance = null;
  }
}

// ============================================================================
// Quick Action Functions
// ============================================================================

/**
 * Quick function to perform a browser task
 */
export async function performBrowserTask(
  goal: string,
  options?: {
    startUrl?: string;
    maxSteps?: number;
    profile?: string;
    stealthMode?: boolean;
  }
): Promise<TaskResult> {
  const agent = getBrowserAgent();

  if (!agent.isReady()) {
    await agent.initialize({
      profileName: options?.profile,
      stealthMode: options?.stealthMode,
    });
  }

  const task: BrowserTask = {
    id: `task_${Date.now()}`,
    goal,
    startUrl: options?.startUrl,
    maxSteps: options?.maxSteps || 20,
  };

  return agent.executeTask(task);
}

/**
 * Quick function to navigate and extract data
 */
export async function browseAndExtract(
  url: string,
  extractionQuery: string
): Promise<any> {
  const agent = getBrowserAgent();

  if (!agent.isReady()) {
    await agent.initialize();
  }

  await agent.navigate(url);
  return agent.extract(extractionQuery);
}
