/**
 * Atlas Desktop - VM Agent Application Plugin System
 *
 * Extensible plugin system for application-specific intelligence.
 * Each plugin provides specialized knowledge about how to interact
 * with a specific application.
 *
 * @module vm-agent/plugins/app-plugin
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { VMAction, ScreenState, UIElement } from '../types';
import { EnhancedUIElement } from '../core/types';
import { ApplicationContext } from '../vision/enhanced-screen';

const logger = createModuleLogger('AppPlugin');

// =============================================================================
// Plugin Types
// =============================================================================

export type PluginCategory =
  | 'productivity'
  | 'development'
  | 'communication'
  | 'media'
  | 'gaming'
  | 'system'
  | 'browser'
  | 'custom';

export interface PluginMetadata {
  /** Plugin ID */
  id: string;
  /** Plugin name */
  name: string;
  /** Plugin version */
  version: string;
  /** Description */
  description: string;
  /** Category */
  category: PluginCategory;
  /** Author */
  author: string;
  /** Supported applications (process names) */
  supportedApps: string[];
  /** Required capabilities */
  requiredCapabilities: string[];
  /** Optional capabilities */
  optionalCapabilities?: string[];
  /** Plugin icon (base64) */
  icon?: string;
  /** Homepage */
  homepage?: string;
  /** Created at */
  createdAt: number;
  /** Updated at */
  updatedAt: number;
}

export interface AppAction {
  /** Action ID */
  id: string;
  /** Action name */
  name: string;
  /** Description */
  description: string;
  /** Category (e.g., 'file', 'edit', 'view') */
  category: string;
  /** Keywords for intent matching */
  keywords: string[];
  /** Parameters */
  parameters: ActionParameter[];
  /** Required context */
  requiredContext?: string[];
  /** Keyboard shortcut (if available) */
  shortcut?: string[];
}

export interface ActionParameter {
  /** Parameter name */
  name: string;
  /** Parameter type */
  type: 'string' | 'number' | 'boolean' | 'file' | 'element' | 'selection';
  /** Description */
  description: string;
  /** Is required */
  required: boolean;
  /** Default value */
  defaultValue?: unknown;
  /** Validation regex (for strings) */
  validation?: string;
  /** Enum values */
  enumValues?: string[];
}

export interface AppState {
  /** Application name */
  appName: string;
  /** Application context */
  context: ApplicationContext;
  /** Current view/mode */
  currentView?: string;
  /** Open documents/tabs */
  openItems?: string[];
  /** Selection */
  selection?: string;
  /** Cursor position */
  cursorPosition?: { x: number; y: number };
  /** Application-specific state */
  customState?: Record<string, unknown>;
}

export interface NavigationTarget {
  /** Target type */
  type: 'menu' | 'button' | 'tab' | 'sidebar' | 'shortcut' | 'search';
  /** Path to target (e.g., ['File', 'Open']) */
  path?: string[];
  /** Shortcut keys */
  shortcut?: string[];
  /** Element selector */
  selector?: string;
  /** Search term */
  searchTerm?: string;
}

export interface ElementPattern {
  /** Pattern ID */
  id: string;
  /** Pattern name */
  name: string;
  /** Element type this pattern identifies */
  elementType: string;
  /** Text patterns (regex) */
  textPatterns?: string[];
  /** Position hints */
  positionHints?: {
    region?: 'top' | 'bottom' | 'left' | 'right' | 'center';
    nearElement?: string;
  };
  /** Attributes to match */
  attributes?: Record<string, string>;
  /** Confidence threshold */
  confidenceThreshold?: number;
}

export interface IntentMapping {
  /** Intent ID */
  id: string;
  /** Natural language patterns */
  patterns: string[];
  /** Action to execute */
  actionId: string;
  /** Parameter extraction patterns */
  parameterExtraction?: Record<string, string>;
  /** Confidence threshold */
  confidenceThreshold: number;
}

export interface WorkflowTemplate {
  /** Template ID */
  id: string;
  /** Template name */
  name: string;
  /** Description */
  description: string;
  /** Steps */
  steps: WorkflowStepTemplate[];
  /** Input parameters */
  inputs: ActionParameter[];
  /** Expected outputs */
  outputs: string[];
}

export interface WorkflowStepTemplate {
  /** Step ID */
  id: string;
  /** Step name */
  name: string;
  /** Action ID to execute */
  actionId: string;
  /** Parameters (can reference previous outputs) */
  parameters: Record<string, unknown>;
  /** Condition to execute */
  condition?: string;
}

// =============================================================================
// Application Plugin Interface
// =============================================================================

/**
 * Base interface for application plugins
 */
export interface IAppPlugin {
  /** Plugin metadata */
  readonly metadata: PluginMetadata;

  /**
   * Initialize the plugin
   */
  initialize(): Promise<void>;

  /**
   * Check if this plugin can handle the given application
   */
  canHandle(context: ApplicationContext): boolean;

  /**
   * Get current application state
   */
  getAppState(screenState: ScreenState, elements: EnhancedUIElement[]): AppState;

  /**
   * Get available actions
   */
  getAvailableActions(state: AppState): AppAction[];

  /**
   * Execute an action
   */
  executeAction(actionId: string, parameters: Record<string, unknown>): Promise<VMAction[]>;

  /**
   * Navigate to a target
   */
  navigateTo(target: NavigationTarget): Promise<VMAction[]>;

  /**
   * Find element by pattern
   */
  findElement(pattern: ElementPattern, elements: EnhancedUIElement[]): EnhancedUIElement | undefined;

  /**
   * Map intent to action
   */
  mapIntent(intent: string, context: AppState): { actionId: string; parameters: Record<string, unknown> } | undefined;

  /**
   * Get workflow templates
   */
  getWorkflowTemplates(): WorkflowTemplate[];

  /**
   * Cleanup
   */
  dispose(): void;
}

// =============================================================================
// Base Plugin Implementation
// =============================================================================

/**
 * Base implementation of application plugin
 *
 * @example
 * ```typescript
 * class VSCodePlugin extends BaseAppPlugin {
 *   constructor() {
 *     super({
 *       id: 'vscode',
 *       name: 'Visual Studio Code',
 *       version: '1.0.0',
 *       description: 'Plugin for VS Code automation',
 *       category: 'development',
 *       author: 'Atlas',
 *       supportedApps: ['code', 'code.exe', 'Visual Studio Code'],
 *       requiredCapabilities: ['keyboard', 'mouse']
 *     });
 *
 *     this.registerAction({
 *       id: 'open-file',
 *       name: 'Open File',
 *       description: 'Open a file in the editor',
 *       category: 'file',
 *       keywords: ['open', 'file', 'load'],
 *       parameters: [
 *         { name: 'path', type: 'file', required: true, description: 'File path' }
 *       ],
 *       shortcut: ['Ctrl', 'o']
 *     });
 *   }
 * }
 * ```
 */
export abstract class BaseAppPlugin extends EventEmitter implements IAppPlugin {
  readonly metadata: PluginMetadata;

  protected actions: Map<string, AppAction> = new Map();
  protected elementPatterns: Map<string, ElementPattern> = new Map();
  protected intentMappings: IntentMapping[] = [];
  protected workflowTemplates: Map<string, WorkflowTemplate> = new Map();
  protected initialized: boolean = false;

  constructor(metadata: Omit<PluginMetadata, 'createdAt' | 'updatedAt'>) {
    super();
    this.metadata = {
      ...metadata,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing plugin', { pluginId: this.metadata.id });

    await this.onInitialize();

    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Override this to perform custom initialization
   */
  protected async onInitialize(): Promise<void> {
    // Override in subclass
  }

  canHandle(context: ApplicationContext): boolean {
    // Use 'application' property which exists on ApplicationContext
    const appName = context.application?.toLowerCase() || '';

    return this.metadata.supportedApps.some(
      (supported) =>
        appName.includes(supported.toLowerCase()),
    );
  }

  getAppState(screenState: ScreenState, elements: EnhancedUIElement[]): AppState {
    return {
      appName: this.metadata.name,
      context: this.extractContext(screenState, elements),
      currentView: this.detectCurrentView(elements),
      openItems: this.detectOpenItems(elements),
      selection: this.detectSelection(elements),
    };
  }

  /**
   * Override to provide custom context extraction
   */
  protected extractContext(_screenState: ScreenState, _elements: EnhancedUIElement[]): ApplicationContext {
    return {
      application: this.metadata.name,
      type: 'unknown',
      screen: 'main',
    };
  }

  /**
   * Override to detect current view
   */
  protected detectCurrentView(_elements: EnhancedUIElement[]): string | undefined {
    return undefined;
  }

  /**
   * Override to detect open items
   */
  protected detectOpenItems(_elements: EnhancedUIElement[]): string[] | undefined {
    return undefined;
  }

  /**
   * Override to detect selection
   */
  protected detectSelection(_elements: EnhancedUIElement[]): string | undefined {
    return undefined;
  }

  getAvailableActions(state: AppState): AppAction[] {
    return Array.from(this.actions.values()).filter((action) =>
      this.isActionAvailable(action, state),
    );
  }

  /**
   * Override to filter available actions based on state
   */
  protected isActionAvailable(_action: AppAction, _state: AppState): boolean {
    return true;
  }

  async executeAction(
    actionId: string,
    parameters: Record<string, unknown>,
  ): Promise<VMAction[]> {
    const action = this.actions.get(actionId);
    if (!action) {
      throw new Error(`Action not found: ${actionId}`);
    }

    // Validate parameters
    this.validateParameters(action, parameters);

    // Generate VM actions
    return this.generateActionsForAction(action, parameters);
  }

  /**
   * Override to generate VM actions for an app action
   */
  protected async generateActionsForAction(
    action: AppAction,
    parameters: Record<string, unknown>,
  ): Promise<VMAction[]> {
    const actions: VMAction[] = [];

    // Default: use shortcut if available
    if (action.shortcut) {
      actions.push({
        type: 'hotkey',
        keys: action.shortcut,
      });
    }

    return actions;
  }

  async navigateTo(target: NavigationTarget): Promise<VMAction[]> {
    const actions: VMAction[] = [];

    switch (target.type) {
      case 'shortcut':
        if (target.shortcut) {
          actions.push({ type: 'hotkey', keys: target.shortcut });
        }
        break;

      case 'menu':
        if (target.path && target.path.length > 0) {
          // Press Alt to activate menu bar
          actions.push({ type: 'keyPress', key: 'Alt' });
          await this.sleep(200);

          // Navigate through menu path
          for (const item of target.path) {
            actions.push({ type: 'type', text: item.charAt(0) }); // Type first letter
            await this.sleep(100);
          }
        }
        break;

      case 'search':
        if (target.searchTerm) {
          // Most apps: Ctrl+F or Ctrl+P
          actions.push({ type: 'hotkey', keys: ['Ctrl', 'p'] });
          await this.sleep(300);
          actions.push({ type: 'type', text: target.searchTerm });
          actions.push({ type: 'keyPress', key: 'Enter' });
        }
        break;
    }

    return actions;
  }

  findElement(
    pattern: ElementPattern,
    elements: EnhancedUIElement[],
  ): EnhancedUIElement | undefined {
    for (const element of elements) {
      let score = 0;

      // Check text patterns
      if (pattern.textPatterns && element.text) {
        for (const textPattern of pattern.textPatterns) {
          if (new RegExp(textPattern, 'i').test(element.text)) {
            score += 0.3;
            break;
          }
        }
      }

      // Check attributes
      if (pattern.attributes) {
        for (const [key, value] of Object.entries(pattern.attributes)) {
          const elementAttr = (element as unknown as Record<string, unknown>)[key];
          if (String(elementAttr) === value) {
            score += 0.2;
          }
        }
      }

      // Check position hints
      if (pattern.positionHints?.region) {
        const region = this.getElementRegion(element);
        if (region === pattern.positionHints.region) {
          score += 0.2;
        }
      }

      // Check type match
      if (element.type === pattern.elementType) {
        score += 0.3;
      }

      const threshold = pattern.confidenceThreshold || 0.5;
      if (score >= threshold) {
        return element;
      }
    }

    return undefined;
  }

  mapIntent(
    intent: string,
    _context: AppState,
  ): { actionId: string; parameters: Record<string, unknown> } | undefined {
    const intentLower = intent.toLowerCase();

    for (const mapping of this.intentMappings) {
      for (const pattern of mapping.patterns) {
        if (intentLower.includes(pattern.toLowerCase())) {
          // Extract parameters
          const parameters: Record<string, unknown> = {};

          if (mapping.parameterExtraction) {
            for (const [paramName, extractPattern] of Object.entries(mapping.parameterExtraction)) {
              const match = intent.match(new RegExp(extractPattern, 'i'));
              if (match && match[1]) {
                parameters[paramName] = match[1];
              }
            }
          }

          return {
            actionId: mapping.actionId,
            parameters,
          };
        }
      }
    }

    return undefined;
  }

  getWorkflowTemplates(): WorkflowTemplate[] {
    return Array.from(this.workflowTemplates.values());
  }

  dispose(): void {
    this.actions.clear();
    this.elementPatterns.clear();
    this.intentMappings = [];
    this.workflowTemplates.clear();
    this.removeAllListeners();
    logger.info('Plugin disposed', { pluginId: this.metadata.id });
  }

  // ==========================================================================
  // Protected Helper Methods
  // ==========================================================================

  /**
   * Register an action
   */
  protected registerAction(action: AppAction): void {
    this.actions.set(action.id, action);
  }

  /**
   * Register an element pattern
   */
  protected registerElementPattern(pattern: ElementPattern): void {
    this.elementPatterns.set(pattern.id, pattern);
  }

  /**
   * Register an intent mapping
   */
  protected registerIntentMapping(mapping: IntentMapping): void {
    this.intentMappings.push(mapping);
    // Sort by confidence threshold (higher first)
    this.intentMappings.sort((a, b) => b.confidenceThreshold - a.confidenceThreshold);
  }

  /**
   * Register a workflow template
   */
  protected registerWorkflowTemplate(template: WorkflowTemplate): void {
    this.workflowTemplates.set(template.id, template);
  }

  private validateParameters(action: AppAction, parameters: Record<string, unknown>): void {
    for (const param of action.parameters) {
      if (param.required && !(param.name in parameters)) {
        throw new Error(`Missing required parameter: ${param.name}`);
      }

      const value = parameters[param.name];
      if (value !== undefined) {
        // Type validation
        switch (param.type) {
          case 'number':
            if (typeof value !== 'number') {
              throw new Error(`Parameter ${param.name} must be a number`);
            }
            break;
          case 'boolean':
            if (typeof value !== 'boolean') {
              throw new Error(`Parameter ${param.name} must be a boolean`);
            }
            break;
          case 'string':
          case 'file':
            if (typeof value !== 'string') {
              throw new Error(`Parameter ${param.name} must be a string`);
            }
            if (param.validation && !new RegExp(param.validation).test(value)) {
              throw new Error(`Parameter ${param.name} failed validation`);
            }
            break;
        }

        // Enum validation
        if (param.enumValues && !param.enumValues.includes(String(value))) {
          throw new Error(
            `Parameter ${param.name} must be one of: ${param.enumValues.join(', ')}`,
          );
        }
      }
    }
  }

  private getElementRegion(
    element: EnhancedUIElement,
  ): 'top' | 'bottom' | 'left' | 'right' | 'center' {
    // Assume 1920x1080 viewport for simplicity
    const centerX = element.bounds.x + element.bounds.width / 2;
    const centerY = element.bounds.y + element.bounds.height / 2;

    if (centerY < 200) return 'top';
    if (centerY > 900) return 'bottom';
    if (centerX < 300) return 'left';
    if (centerX > 1600) return 'right';
    return 'center';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Built-in Plugin: Generic Windows App
// =============================================================================

/**
 * Generic Windows application plugin
 * Provides basic functionality for any Windows application
 */
export class GenericWindowsPlugin extends BaseAppPlugin {
  constructor() {
    super({
      id: 'generic-windows',
      name: 'Generic Windows Application',
      version: '1.0.0',
      description: 'Basic automation for any Windows application',
      category: 'system',
      author: 'Atlas',
      supportedApps: ['*'],
      requiredCapabilities: ['keyboard', 'mouse'],
    });

    this.setupGenericActions();
    this.setupGenericPatterns();
    this.setupGenericIntents();
  }

  canHandle(_context: ApplicationContext): boolean {
    // Always returns true as fallback
    return true;
  }

  private setupGenericActions(): void {
    // Common file operations
    this.registerAction({
      id: 'new',
      name: 'New',
      description: 'Create new document',
      category: 'file',
      keywords: ['new', 'create'],
      parameters: [],
      shortcut: ['Ctrl', 'n'],
    });

    this.registerAction({
      id: 'open',
      name: 'Open',
      description: 'Open file',
      category: 'file',
      keywords: ['open', 'load'],
      parameters: [],
      shortcut: ['Ctrl', 'o'],
    });

    this.registerAction({
      id: 'save',
      name: 'Save',
      description: 'Save current file',
      category: 'file',
      keywords: ['save'],
      parameters: [],
      shortcut: ['Ctrl', 's'],
    });

    this.registerAction({
      id: 'save-as',
      name: 'Save As',
      description: 'Save file with new name',
      category: 'file',
      keywords: ['save', 'as'],
      parameters: [],
      shortcut: ['Ctrl', 'Shift', 's'],
    });

    this.registerAction({
      id: 'close',
      name: 'Close',
      description: 'Close current window/tab',
      category: 'file',
      keywords: ['close', 'exit'],
      parameters: [],
      shortcut: ['Ctrl', 'w'],
    });

    // Edit operations
    this.registerAction({
      id: 'undo',
      name: 'Undo',
      description: 'Undo last action',
      category: 'edit',
      keywords: ['undo', 'revert'],
      parameters: [],
      shortcut: ['Ctrl', 'z'],
    });

    this.registerAction({
      id: 'redo',
      name: 'Redo',
      description: 'Redo last undone action',
      category: 'edit',
      keywords: ['redo'],
      parameters: [],
      shortcut: ['Ctrl', 'y'],
    });

    this.registerAction({
      id: 'cut',
      name: 'Cut',
      description: 'Cut selection',
      category: 'edit',
      keywords: ['cut'],
      parameters: [],
      shortcut: ['Ctrl', 'x'],
    });

    this.registerAction({
      id: 'copy',
      name: 'Copy',
      description: 'Copy selection',
      category: 'edit',
      keywords: ['copy'],
      parameters: [],
      shortcut: ['Ctrl', 'c'],
    });

    this.registerAction({
      id: 'paste',
      name: 'Paste',
      description: 'Paste from clipboard',
      category: 'edit',
      keywords: ['paste'],
      parameters: [],
      shortcut: ['Ctrl', 'v'],
    });

    this.registerAction({
      id: 'select-all',
      name: 'Select All',
      description: 'Select all content',
      category: 'edit',
      keywords: ['select', 'all'],
      parameters: [],
      shortcut: ['Ctrl', 'a'],
    });

    this.registerAction({
      id: 'find',
      name: 'Find',
      description: 'Find text',
      category: 'edit',
      keywords: ['find', 'search'],
      parameters: [
        {
          name: 'text',
          type: 'string',
          description: 'Text to find',
          required: false,
        },
      ],
      shortcut: ['Ctrl', 'f'],
    });

    this.registerAction({
      id: 'replace',
      name: 'Find and Replace',
      description: 'Find and replace text',
      category: 'edit',
      keywords: ['replace', 'find'],
      parameters: [],
      shortcut: ['Ctrl', 'h'],
    });

    // View operations
    this.registerAction({
      id: 'zoom-in',
      name: 'Zoom In',
      description: 'Increase zoom',
      category: 'view',
      keywords: ['zoom', 'in', 'larger'],
      parameters: [],
      shortcut: ['Ctrl', '+'],
    });

    this.registerAction({
      id: 'zoom-out',
      name: 'Zoom Out',
      description: 'Decrease zoom',
      category: 'view',
      keywords: ['zoom', 'out', 'smaller'],
      parameters: [],
      shortcut: ['Ctrl', '-'],
    });

    this.registerAction({
      id: 'fullscreen',
      name: 'Fullscreen',
      description: 'Toggle fullscreen',
      category: 'view',
      keywords: ['fullscreen', 'maximize'],
      parameters: [],
      shortcut: ['F11'],
    });

    // Window operations
    this.registerAction({
      id: 'minimize',
      name: 'Minimize',
      description: 'Minimize window',
      category: 'window',
      keywords: ['minimize'],
      parameters: [],
    });

    this.registerAction({
      id: 'maximize',
      name: 'Maximize',
      description: 'Maximize window',
      category: 'window',
      keywords: ['maximize'],
      parameters: [],
    });

    this.registerAction({
      id: 'help',
      name: 'Help',
      description: 'Open help',
      category: 'help',
      keywords: ['help', 'documentation'],
      parameters: [],
      shortcut: ['F1'],
    });
  }

  private setupGenericPatterns(): void {
    this.registerElementPattern({
      id: 'close-button',
      name: 'Close Button',
      elementType: 'button',
      textPatterns: ['close', 'x', '×'],
      positionHints: { region: 'top' },
    });

    this.registerElementPattern({
      id: 'ok-button',
      name: 'OK Button',
      elementType: 'button',
      textPatterns: ['ok', 'confirm', 'yes', 'accept'],
    });

    this.registerElementPattern({
      id: 'cancel-button',
      name: 'Cancel Button',
      elementType: 'button',
      textPatterns: ['cancel', 'no', 'close'],
    });

    this.registerElementPattern({
      id: 'save-button',
      name: 'Save Button',
      elementType: 'button',
      textPatterns: ['save', 'apply'],
    });

    this.registerElementPattern({
      id: 'search-input',
      name: 'Search Input',
      elementType: 'input',
      textPatterns: ['search', 'find', 'filter'],
    });
  }

  private setupGenericIntents(): void {
    this.registerIntentMapping({
      id: 'save-intent',
      patterns: ['save', 'save file', 'save document', 'save changes'],
      actionId: 'save',
      confidenceThreshold: 0.8,
    });

    this.registerIntentMapping({
      id: 'open-intent',
      patterns: ['open', 'open file', 'load'],
      actionId: 'open',
      confidenceThreshold: 0.8,
    });

    this.registerIntentMapping({
      id: 'undo-intent',
      patterns: ['undo', 'undo that', 'revert', 'go back'],
      actionId: 'undo',
      confidenceThreshold: 0.8,
    });

    this.registerIntentMapping({
      id: 'copy-intent',
      patterns: ['copy', 'copy this', 'copy that'],
      actionId: 'copy',
      confidenceThreshold: 0.8,
    });

    this.registerIntentMapping({
      id: 'paste-intent',
      patterns: ['paste', 'paste here'],
      actionId: 'paste',
      confidenceThreshold: 0.8,
    });

    this.registerIntentMapping({
      id: 'find-intent',
      patterns: ['find', 'search for', 'look for'],
      actionId: 'find',
      parameterExtraction: {
        text: 'find\\s+(.+)',
      },
      confidenceThreshold: 0.7,
    });
  }

  protected async generateActionsForAction(
    action: AppAction,
    parameters: Record<string, unknown>,
  ): Promise<VMAction[]> {
    const actions = await super.generateActionsForAction(action, parameters);

    // For find action, also type the search text
    if (action.id === 'find' && parameters.text) {
      actions.push({ type: 'type', text: String(parameters.text) });
    }

    return actions;
  }
}

// =============================================================================
// All interfaces and classes are exported at declaration
// =============================================================================
