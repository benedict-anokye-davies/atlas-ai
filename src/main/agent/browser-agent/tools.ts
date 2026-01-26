/**
 * Browser Agent Tools
 *
 * Agent tools that expose the browser agent capabilities to the LLM.
 * These tools enable natural language browser automation.
 *
 * @module agent/browser-agent/tools
 */

import { createModuleLogger } from '../../utils/logger';
import { getBrowserAgent, performBrowserTask, browseAndExtract } from './index';
import { BrowserTask, TaskResult, BrowserAgentConfig } from './types';

const logger = createModuleLogger('BrowserAgentTools');

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Tool: Execute a browser task with natural language
 */
export async function browserExecuteTask(params: {
  goal: string;
  startUrl?: string;
  maxSteps?: number;
  profile?: string;
  stealthMode?: boolean;
}): Promise<TaskResult> {
  logger.info('Executing browser task', { goal: params.goal });

  try {
    const result = await performBrowserTask(params.goal, {
      startUrl: params.startUrl,
      maxSteps: params.maxSteps || 20,
      profile: params.profile,
      stealthMode: params.stealthMode,
    });

    return result;
  } catch (error) {
    logger.error('Browser task failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      steps: [],
      totalDuration: 0,
    };
  }
}

/**
 * Tool: Navigate to a URL
 */
export async function browserNavigate(params: {
  url: string;
  waitUntil?: 'load' | 'networkidle2' | 'domcontentloaded';
}): Promise<{ success: boolean; url: string; title?: string; error?: string }> {
  logger.info('Navigating to URL', { url: params.url });

  try {
    const agent = getBrowserAgent();

    if (!agent.isReady()) {
      await agent.initialize();
    }

    await agent.navigate(params.url);

    return {
      success: true,
      url: params.url,
      title: 'Navigation complete',
    };
  } catch (error) {
    logger.error('Navigation failed', error);
    return {
      success: false,
      url: params.url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tool: Click on an element by description
 */
export async function browserClick(params: {
  description: string;
  waitAfter?: number;
}): Promise<{ success: boolean; clicked: string; error?: string }> {
  logger.info('Clicking element', { description: params.description });

  try {
    const agent = getBrowserAgent();

    if (!agent.isReady()) {
      await agent.initialize();
    }

    const result = await agent.click(params.description);

    return {
      success: !!result,
      clicked: params.description,
    };
  } catch (error) {
    logger.error('Click failed', error);
    return {
      success: false,
      clicked: params.description,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tool: Type text into an element
 */
export async function browserType(params: {
  text: string;
  elementDescription?: string;
  pressEnter?: boolean;
}): Promise<{ success: boolean; typed: string; error?: string }> {
  logger.info('Typing text', {
    element: params.elementDescription,
    textLength: params.text.length,
  });

  try {
    const agent = getBrowserAgent();

    if (!agent.isReady()) {
      await agent.initialize();
    }

    const result = await agent.type(params.text, params.elementDescription);

    return {
      success: !!result,
      typed: params.text,
    };
  } catch (error) {
    logger.error('Type failed', error);
    return {
      success: false,
      typed: params.text,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tool: Extract data from the current page
 */
export async function browserExtract(params: {
  query: string;
  format?: 'text' | 'json' | 'html';
}): Promise<{ success: boolean; data?: any; error?: string }> {
  logger.info('Extracting data', { query: params.query });

  try {
    const agent = getBrowserAgent();

    if (!agent.isReady()) {
      await agent.initialize();
    }

    const data = await agent.extract(params.query);

    return {
      success: true,
      data,
    };
  } catch (error) {
    logger.error('Extraction failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tool: Browse a URL and extract specific information
 */
export async function browserBrowseAndExtract(params: {
  url: string;
  extractionQuery: string;
}): Promise<{ success: boolean; url: string; data?: any; error?: string }> {
  logger.info('Browse and extract', { url: params.url, query: params.extractionQuery });

  try {
    const data = await browseAndExtract(params.url, params.extractionQuery);

    return {
      success: true,
      url: params.url,
      data,
    };
  } catch (error) {
    logger.error('Browse and extract failed', error);
    return {
      success: false,
      url: params.url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tool: Create a new browser tab
 */
export async function browserCreateTab(params: {
  url?: string;
  purpose?: string;
}): Promise<{ success: boolean; tabId?: string; error?: string }> {
  logger.info('Creating new tab', { url: params.url, purpose: params.purpose });

  try {
    const agent = getBrowserAgent();

    if (!agent.isReady()) {
      await agent.initialize();
    }

    const tabId = await agent.createTab({
      url: params.url,
      purpose: params.purpose,
    });

    return {
      success: true,
      tabId,
    };
  } catch (error) {
    logger.error('Create tab failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tool: Switch to a different tab
 */
export async function browserSwitchTab(params: {
  tabId: string;
}): Promise<{ success: boolean; error?: string }> {
  logger.info('Switching tab', { tabId: params.tabId });

  try {
    const agent = getBrowserAgent();

    if (!agent.isReady()) {
      throw new Error('Browser agent not initialized');
    }

    await agent.switchTab(params.tabId);

    return { success: true };
  } catch (error) {
    logger.error('Switch tab failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tool: Close a browser tab
 */
export async function browserCloseTab(params: {
  tabId: string;
}): Promise<{ success: boolean; error?: string }> {
  logger.info('Closing tab', { tabId: params.tabId });

  try {
    const agent = getBrowserAgent();

    if (!agent.isReady()) {
      throw new Error('Browser agent not initialized');
    }

    await agent.closeTab(params.tabId);

    return { success: true };
  } catch (error) {
    logger.error('Close tab failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tool: Get list of open tabs
 */
export async function browserGetTabs(): Promise<{
  success: boolean;
  tabs?: Array<{ id: string; url: string; title: string; active: boolean }>;
  error?: string;
}> {
  logger.info('Getting tabs');

  try {
    const agent = getBrowserAgent();

    if (!agent.isReady()) {
      await agent.initialize();
    }

    const tabs = agent.getTabs();

    return {
      success: true,
      tabs,
    };
  } catch (error) {
    logger.error('Get tabs failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tool: Save browser session to a profile
 */
export async function browserSaveProfile(params: {
  profileName: string;
}): Promise<{ success: boolean; error?: string }> {
  logger.info('Saving profile', { name: params.profileName });

  try {
    const agent = getBrowserAgent();

    if (!agent.isReady()) {
      throw new Error('Browser agent not initialized');
    }

    await agent.saveProfile(params.profileName);

    return { success: true };
  } catch (error) {
    logger.error('Save profile failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tool: Load a browser profile
 */
export async function browserLoadProfile(params: {
  profileName: string;
}): Promise<{ success: boolean; error?: string }> {
  logger.info('Loading profile', { name: params.profileName });

  try {
    const agent = getBrowserAgent();

    if (!agent.isReady()) {
      await agent.initialize({ profileName: params.profileName });
    } else {
      await agent.loadProfile(params.profileName);
    }

    return { success: true };
  } catch (error) {
    logger.error('Load profile failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tool: Get browser agent status
 */
export async function browserGetStatus(): Promise<{
  success: boolean;
  status?: {
    initialized: boolean;
    tabCount: number;
    activeProfile: string | null;
    stealthMode: boolean;
  };
  error?: string;
}> {
  try {
    const agent = getBrowserAgent();
    const status = agent.getStatus();

    return {
      success: true,
      status,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tool: Enable or disable stealth mode
 */
export async function browserSetStealthMode(params: {
  enabled: boolean;
}): Promise<{ success: boolean; error?: string }> {
  logger.info('Setting stealth mode', { enabled: params.enabled });

  try {
    const agent = getBrowserAgent();

    if (!agent.isReady()) {
      await agent.initialize({ stealthMode: params.enabled });
    } else {
      await agent.setStealthMode(params.enabled);
    }

    return { success: true };
  } catch (error) {
    logger.error('Set stealth mode failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tool: Close the browser agent
 */
export async function browserClose(): Promise<{ success: boolean; error?: string }> {
  logger.info('Closing browser agent');

  try {
    const agent = getBrowserAgent();
    await agent.close();

    return { success: true };
  } catch (error) {
    logger.error('Close browser failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Tool Schemas for LLM
// ============================================================================

/**
 * Tool schemas for registration with llm-tools
 */
export const BROWSER_AGENT_TOOL_SCHEMAS = [
  {
    name: 'browser_execute_task',
    description:
      'Execute a complex browser task using natural language. The AI will plan and execute multiple steps to achieve the goal. Use this for multi-step workflows like "Log into Gmail and send an email to John".',
    parameters: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description: 'Natural language description of what to accomplish',
        },
        startUrl: {
          type: 'string',
          description: 'Optional starting URL',
        },
        maxSteps: {
          type: 'number',
          description: 'Maximum number of steps (default: 20)',
        },
        profile: {
          type: 'string',
          description: 'Profile name to use for saved sessions/cookies',
        },
        stealthMode: {
          type: 'boolean',
          description: 'Enable stealth mode to avoid bot detection',
        },
      },
      required: ['goal'],
    },
    handler: browserExecuteTask,
  },
  {
    name: 'browser_navigate',
    description: 'Navigate to a URL in the browser',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to',
        },
        waitUntil: {
          type: 'string',
          enum: ['load', 'networkidle2', 'domcontentloaded'],
          description: 'When to consider navigation complete',
        },
      },
      required: ['url'],
    },
    handler: browserNavigate,
  },
  {
    name: 'browser_click',
    description:
      'Click on an element by natural language description. Example: "the login button", "search icon", "first result"',
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Natural language description of the element to click',
        },
        waitAfter: {
          type: 'number',
          description: 'Milliseconds to wait after clicking',
        },
      },
      required: ['description'],
    },
    handler: browserClick,
  },
  {
    name: 'browser_type',
    description: 'Type text into an input field',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The text to type',
        },
        elementDescription: {
          type: 'string',
          description:
            'Optional description of the input field. If not provided, types into the focused element.',
        },
        pressEnter: {
          type: 'boolean',
          description: 'Press Enter after typing',
        },
      },
      required: ['text'],
    },
    handler: browserType,
  },
  {
    name: 'browser_extract',
    description:
      'Extract specific information from the current page using natural language query',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'What to extract. Example: "all product prices", "the main article text", "email addresses"',
        },
        format: {
          type: 'string',
          enum: ['text', 'json', 'html'],
          description: 'Output format for extracted data',
        },
      },
      required: ['query'],
    },
    handler: browserExtract,
  },
  {
    name: 'browser_browse_and_extract',
    description: 'Navigate to a URL and extract specific information in one step',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to',
        },
        extractionQuery: {
          type: 'string',
          description: 'What to extract from the page',
        },
      },
      required: ['url', 'extractionQuery'],
    },
    handler: browserBrowseAndExtract,
  },
  {
    name: 'browser_create_tab',
    description: 'Create a new browser tab',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Optional URL to open in the new tab',
        },
        purpose: {
          type: 'string',
          description: 'Optional description of what this tab is for',
        },
      },
    },
    handler: browserCreateTab,
  },
  {
    name: 'browser_switch_tab',
    description: 'Switch to a different browser tab',
    parameters: {
      type: 'object',
      properties: {
        tabId: {
          type: 'string',
          description: 'ID of the tab to switch to',
        },
      },
      required: ['tabId'],
    },
    handler: browserSwitchTab,
  },
  {
    name: 'browser_get_tabs',
    description: 'Get a list of all open browser tabs',
    parameters: {
      type: 'object',
      properties: {},
    },
    handler: browserGetTabs,
  },
  {
    name: 'browser_close_tab',
    description: 'Close a browser tab',
    parameters: {
      type: 'object',
      properties: {
        tabId: {
          type: 'string',
          description: 'ID of the tab to close',
        },
      },
      required: ['tabId'],
    },
    handler: browserCloseTab,
  },
  {
    name: 'browser_save_profile',
    description:
      'Save the current browser session (cookies, localStorage, auth state) to a named profile',
    parameters: {
      type: 'object',
      properties: {
        profileName: {
          type: 'string',
          description: 'Name for the profile',
        },
      },
      required: ['profileName'],
    },
    handler: browserSaveProfile,
  },
  {
    name: 'browser_load_profile',
    description: 'Load a saved browser profile to restore session state',
    parameters: {
      type: 'object',
      properties: {
        profileName: {
          type: 'string',
          description: 'Name of the profile to load',
        },
      },
      required: ['profileName'],
    },
    handler: browserLoadProfile,
  },
  {
    name: 'browser_get_status',
    description: 'Get the current status of the browser agent',
    parameters: {
      type: 'object',
      properties: {},
    },
    handler: browserGetStatus,
  },
  {
    name: 'browser_set_stealth_mode',
    description: 'Enable or disable stealth mode for avoiding bot detection',
    parameters: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'Whether to enable stealth mode',
        },
      },
      required: ['enabled'],
    },
    handler: browserSetStealthMode,
  },
  {
    name: 'browser_close',
    description: 'Close the browser and clean up resources',
    parameters: {
      type: 'object',
      properties: {},
    },
    handler: browserClose,
  },
];

/**
 * Get all browser agent tools for registration
 */
export function getBrowserAgentTools() {
  return BROWSER_AGENT_TOOL_SCHEMAS;
}
