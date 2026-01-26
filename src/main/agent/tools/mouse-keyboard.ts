/**
 * Atlas Desktop - Mouse & Keyboard Tool
 *
 * Provides mouse and keyboard automation using robotjs.
 * Supports:
 * - Mouse movement, clicks (left, right, double)
 * - Keyboard typing and key combinations
 * - Screenshot capture
 * - Clipboard operations
 *
 * @module agent/tools/mouse-keyboard
 */

import robot from '@jitsi/robotjs';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('MouseKeyboardTool');

/**
 * Mouse/keyboard action input
 */
export interface MouseKeyboardInput {
  action:
    | 'move'
    | 'click'
    | 'doubleClick'
    | 'rightClick'
    | 'scroll'
    | 'type'
    | 'keyPress'
    | 'keyTap'
    | 'getMousePos'
    | 'getScreenSize'
    | 'getPixelColor';
  x?: number;
  y?: number;
  text?: string;
  keys?: string[]; // e.g., ['control', 'c']
  key?: string; // Single key for keyTap
  modifiers?: string[]; // Modifier keys for keyTap
  scrollAmount?: number; // Scroll amount (positive = up, negative = down)
  delay?: number; // Delay in ms for typing
}

/**
 * Mouse/keyboard action output
 */
export interface MouseKeyboardOutput {
  success: boolean;
  data?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    color?: string;
  };
  error?: string;
}

/**
 * Map of common key names to robotjs key names
 */
const KEY_MAP: Record<string, string> = {
  // Modifiers
  ctrl: 'control',
  control: 'control',
  alt: 'alt',
  shift: 'shift',
  command: 'command',
  cmd: 'command',
  win: 'command', // Windows key maps to command
  super: 'command',

  // Special keys
  enter: 'enter',
  return: 'enter',
  tab: 'tab',
  escape: 'escape',
  esc: 'escape',
  backspace: 'backspace',
  delete: 'delete',
  space: 'space',

  // Arrow keys
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',

  // Navigation
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pagedown: 'pagedown',

  // Function keys
  f1: 'f1',
  f2: 'f2',
  f3: 'f3',
  f4: 'f4',
  f5: 'f5',
  f6: 'f6',
  f7: 'f7',
  f8: 'f8',
  f9: 'f9',
  f10: 'f10',
  f11: 'f11',
  f12: 'f12',

  // Other
  printscreen: 'printscreen',
  insert: 'insert',
  numlock: 'numlock',
  capslock: 'capslock',
  scrolllock: 'scrolllock',
};

/**
 * Normalize a key name to robotjs format
 */
function normalizeKey(key: string): string {
  const lower = key.toLowerCase();
  return KEY_MAP[lower] || lower;
}

/**
 * Mouse and Keyboard automation tool
 */
export class MouseKeyboardTool {
  constructor() {
    // Configure robotjs settings
    robot.setMouseDelay(10);
    robot.setKeyboardDelay(10);
  }

  /**
   * Execute a mouse/keyboard action
   */
  async execute(input: MouseKeyboardInput): Promise<MouseKeyboardOutput> {
    try {
      switch (input.action) {
        case 'move':
          return this.moveMouse(input.x!, input.y!);
        case 'click':
          return this.click(input.x, input.y);
        case 'doubleClick':
          return this.doubleClick(input.x, input.y);
        case 'rightClick':
          return this.rightClick(input.x, input.y);
        case 'scroll':
          return this.scroll(input.scrollAmount || 0, input.x, input.y);
        case 'type':
          return this.typeText(input.text || '', input.delay);
        case 'keyPress':
          return this.pressKeys(input.keys || []);
        case 'keyTap':
          return this.keyTap(input.key || '', input.modifiers);
        case 'getMousePos':
          return this.getMousePosition();
        case 'getScreenSize':
          return this.getScreenSize();
        case 'getPixelColor':
          return this.getPixelColor(input.x!, input.y!);
        default:
          return { success: false, error: `Unknown action: ${input.action}` };
      }
    } catch (error) {
      const err = error as Error;
      logger.error('Mouse/keyboard action failed', { action: input.action, error: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Move mouse to absolute position
   */
  private moveMouse(x: number, y: number): MouseKeyboardOutput {
    robot.moveMouse(x, y);
    logger.debug('Mouse moved', { x, y });
    return { success: true, data: { x, y } };
  }

  /**
   * Left click at position (or current position if not specified)
   */
  private click(x?: number, y?: number): MouseKeyboardOutput {
    if (x !== undefined && y !== undefined) {
      robot.moveMouse(x, y);
    }
    robot.mouseClick('left');
    const pos = robot.getMousePos();
    logger.debug('Mouse clicked', { x: pos.x, y: pos.y });
    return { success: true, data: { x: pos.x, y: pos.y } };
  }

  /**
   * Double-click at position
   */
  private doubleClick(x?: number, y?: number): MouseKeyboardOutput {
    if (x !== undefined && y !== undefined) {
      robot.moveMouse(x, y);
    }
    robot.mouseClick('left', true);
    const pos = robot.getMousePos();
    logger.debug('Mouse double-clicked', { x: pos.x, y: pos.y });
    return { success: true, data: { x: pos.x, y: pos.y } };
  }

  /**
   * Right-click at position
   */
  private rightClick(x?: number, y?: number): MouseKeyboardOutput {
    if (x !== undefined && y !== undefined) {
      robot.moveMouse(x, y);
    }
    robot.mouseClick('right');
    const pos = robot.getMousePos();
    logger.debug('Mouse right-clicked', { x: pos.x, y: pos.y });
    return { success: true, data: { x: pos.x, y: pos.y } };
  }

  /**
   * Scroll the mouse wheel
   */
  private scroll(amount: number, x?: number, y?: number): MouseKeyboardOutput {
    if (x !== undefined && y !== undefined) {
      robot.moveMouse(x, y);
    }
    // robotjs scrollMouse takes magnitude and direction separately
    // Positive = up, negative = down
    if (amount > 0) {
      robot.scrollMouse(0, amount);
    } else {
      robot.scrollMouse(0, amount);
    }
    logger.debug('Mouse scrolled', { amount });
    return { success: true };
  }

  /**
   * Type text string
   */
  private typeText(text: string, delay?: number): MouseKeyboardOutput {
    if (delay !== undefined && delay > 0) {
      robot.setKeyboardDelay(delay);
    }
    robot.typeString(text);
    if (delay !== undefined && delay > 0) {
      robot.setKeyboardDelay(10); // Reset to default
    }
    logger.debug('Text typed', { length: text.length });
    return { success: true };
  }

  /**
   * Press a combination of keys (e.g., Ctrl+C)
   */
  private pressKeys(keys: string[]): MouseKeyboardOutput {
    if (keys.length === 0) {
      return { success: false, error: 'No keys specified' };
    }

    // Normalize all keys
    const normalizedKeys = keys.map(normalizeKey);

    // Separate modifiers from the main key
    const modifiers = ['control', 'alt', 'shift', 'command'];
    const modifierKeys = normalizedKeys.filter((k) => modifiers.includes(k));
    const regularKeys = normalizedKeys.filter((k) => !modifiers.includes(k));

    // If only modifiers, just press them (probably not intended)
    if (regularKeys.length === 0) {
      return { success: false, error: 'No main key specified, only modifiers' };
    }

    // Press the combination
    const mainKey = regularKeys[0]; // Use first regular key
    robot.keyTap(mainKey, modifierKeys);

    logger.debug('Keys pressed', { keys: normalizedKeys });
    return { success: true };
  }

  /**
   * Tap a single key with optional modifiers
   */
  private keyTap(key: string, modifiers?: string[]): MouseKeyboardOutput {
    const normalizedKey = normalizeKey(key);
    const normalizedMods = modifiers?.map(normalizeKey);

    if (normalizedMods && normalizedMods.length > 0) {
      robot.keyTap(normalizedKey, normalizedMods);
    } else {
      robot.keyTap(normalizedKey);
    }

    logger.debug('Key tapped', { key: normalizedKey, modifiers: normalizedMods });
    return { success: true };
  }

  /**
   * Get current mouse position
   */
  private getMousePosition(): MouseKeyboardOutput {
    const pos = robot.getMousePos();
    return { success: true, data: { x: pos.x, y: pos.y } };
  }

  /**
   * Get screen size
   */
  private getScreenSize(): MouseKeyboardOutput {
    const size = robot.getScreenSize();
    return { success: true, data: { width: size.width, height: size.height } };
  }

  /**
   * Get pixel color at position
   */
  private getPixelColor(x: number, y: number): MouseKeyboardOutput {
    const color = robot.getPixelColor(x, y);
    return { success: true, data: { x, y, color } };
  }
}

// Create singleton instance
export const mouseKeyboardTool = new MouseKeyboardTool();

// ============================================================================
// AGENT TOOL DEFINITIONS
// ============================================================================

/**
 * Move mouse tool
 */
export const moveMouseTool: AgentTool = {
  name: 'mouse_move',
  description: 'Move the mouse cursor to an absolute screen position.',
  parameters: {
    type: 'object',
    properties: {
      x: { type: 'number', description: 'X coordinate (pixels from left)' },
      y: { type: 'number', description: 'Y coordinate (pixels from top)' },
    },
    required: ['x', 'y'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await mouseKeyboardTool.execute({
      action: 'move',
      x: params.x as number,
      y: params.y as number,
    });
    return {
      success: result.success,
      data: result.data,
      error: result.error,
      metadata: {
        voiceResponse: result.success
          ? `Moved mouse to ${params.x}, ${params.y}`
          : `Failed to move mouse: ${result.error}`,
      },
    };
  },
};

/**
 * Mouse click tool
 */
export const mouseClickTool: AgentTool = {
  name: 'mouse_click',
  description:
    'Click the mouse at the current position or at specified coordinates. Supports left, right, and double-click.',
  parameters: {
    type: 'object',
    properties: {
      x: { type: 'number', description: 'Optional X coordinate' },
      y: { type: 'number', description: 'Optional Y coordinate' },
      button: {
        type: 'string',
        description: 'Button type: left (default), right, or double',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const button = (params.button as string) || 'left';
    let action: MouseKeyboardInput['action'] = 'click';

    if (button === 'right') action = 'rightClick';
    else if (button === 'double') action = 'doubleClick';

    const result = await mouseKeyboardTool.execute({
      action,
      x: params.x as number | undefined,
      y: params.y as number | undefined,
    });

    return {
      success: result.success,
      data: result.data,
      error: result.error,
      metadata: {
        voiceResponse: result.success ? 'Clicked' : `Click failed: ${result.error}`,
      },
    };
  },
};

/**
 * Mouse scroll tool
 */
export const mouseScrollTool: AgentTool = {
  name: 'mouse_scroll',
  description: 'Scroll the mouse wheel up or down.',
  parameters: {
    type: 'object',
    properties: {
      amount: {
        type: 'number',
        description: 'Scroll amount (positive = up, negative = down)',
      },
      x: { type: 'number', description: 'Optional X coordinate to scroll at' },
      y: { type: 'number', description: 'Optional Y coordinate to scroll at' },
    },
    required: ['amount'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await mouseKeyboardTool.execute({
      action: 'scroll',
      scrollAmount: params.amount as number,
      x: params.x as number | undefined,
      y: params.y as number | undefined,
    });

    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  },
};

/**
 * Type text tool (renamed to avoid conflict with browser.ts typeTextTool)
 */
export const keyboardTypeTool: AgentTool = {
  name: 'keyboard_type',
  description: 'Type a string of text as if typed on the keyboard.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to type' },
      delay: {
        type: 'number',
        description: 'Delay between keystrokes in ms (default: 10)',
      },
    },
    required: ['text'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await mouseKeyboardTool.execute({
      action: 'type',
      text: params.text as string,
      delay: params.delay as number | undefined,
    });

    return {
      success: result.success,
      error: result.error,
      metadata: {
        voiceResponse: result.success ? 'Typed the text' : `Failed to type: ${result.error}`,
      },
    };
  },
};

/**
 * Key press tool (for shortcuts like Ctrl+C)
 */
export const keyPressTool: AgentTool = {
  name: 'keyboard_shortcut',
  description:
    'Press a keyboard shortcut (e.g., Ctrl+C, Alt+Tab). Provide an array of keys to press together.',
  parameters: {
    type: 'object',
    properties: {
      keys: {
        type: 'array',
        description:
          'Array of keys to press together (e.g., ["ctrl", "c"] for Ctrl+C). Supports: ctrl, alt, shift, enter, escape, tab, space, up, down, left, right, f1-f12, and regular letters.',
      },
    },
    required: ['keys'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await mouseKeyboardTool.execute({
      action: 'keyPress',
      keys: params.keys as string[],
    });

    const keysStr = (params.keys as string[]).join('+');
    return {
      success: result.success,
      error: result.error,
      metadata: {
        voiceResponse: result.success
          ? `Pressed ${keysStr}`
          : `Failed to press ${keysStr}: ${result.error}`,
      },
    };
  },
};

/**
 * Single key tap tool
 */
export const keyTapTool: AgentTool = {
  name: 'keyboard_tap',
  description: 'Tap a single key with optional modifiers.',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Key to tap (e.g., "enter", "a", "f5")' },
      modifiers: {
        type: 'array',
        description: 'Optional modifier keys (e.g., ["ctrl", "shift"])',
      },
    },
    required: ['key'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await mouseKeyboardTool.execute({
      action: 'keyTap',
      key: params.key as string,
      modifiers: params.modifiers as string[] | undefined,
    });

    return {
      success: result.success,
      error: result.error,
    };
  },
};

/**
 * Get mouse position tool
 */
export const getMousePositionTool: AgentTool = {
  name: 'mouse_position',
  description: 'Get the current mouse cursor position.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    const result = await mouseKeyboardTool.execute({ action: 'getMousePos' });

    return {
      success: result.success,
      data: result.data,
      error: result.error,
      metadata: {
        voiceResponse: result.success
          ? `Mouse is at ${result.data?.x}, ${result.data?.y}`
          : `Failed to get position: ${result.error}`,
      },
    };
  },
};

/**
 * Get screen size tool
 */
export const getScreenSizeTool: AgentTool = {
  name: 'screen_size',
  description: 'Get the screen resolution.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    const result = await mouseKeyboardTool.execute({ action: 'getScreenSize' });

    return {
      success: result.success,
      data: result.data,
      error: result.error,
      metadata: {
        voiceResponse: result.success
          ? `Screen is ${result.data?.width} by ${result.data?.height} pixels`
          : `Failed to get screen size: ${result.error}`,
      },
    };
  },
};

/**
 * Get pixel color tool
 */
export const getPixelColorTool: AgentTool = {
  name: 'screen_pixel_color',
  description: 'Get the color of a pixel at a specific screen position.',
  parameters: {
    type: 'object',
    properties: {
      x: { type: 'number', description: 'X coordinate' },
      y: { type: 'number', description: 'Y coordinate' },
    },
    required: ['x', 'y'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await mouseKeyboardTool.execute({
      action: 'getPixelColor',
      x: params.x as number,
      y: params.y as number,
    });

    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  },
};

/**
 * Get all mouse/keyboard tools
 */
export function getMouseKeyboardTools(): AgentTool[] {
  return [
    moveMouseTool,
    mouseClickTool,
    mouseScrollTool,
    keyboardTypeTool,
    keyPressTool,
    keyTapTool,
    getMousePositionTool,
    getScreenSizeTool,
    getPixelColorTool,
  ];
}

export default {
  mouseKeyboardTool,
  moveMouseTool,
  mouseClickTool,
  mouseScrollTool,
  keyboardTypeTool,
  keyPressTool,
  keyTapTool,
  getMousePositionTool,
  getScreenSizeTool,
  getPixelColorTool,
  getMouseKeyboardTools,
};
