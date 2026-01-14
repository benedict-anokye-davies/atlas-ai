/**
 * Nova Desktop - Agent Tools
 * Built-in tools for the Nova agent
 */

import { AgentTool, ActionResult } from './index';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('AgentTools');

/**
 * Current time tool - Get current date and time
 */
export const currentTimeTool: AgentTool = {
  name: 'get_current_time',
  description: "Get the current date and time in the user's timezone",
  parameters: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: 'Optional timezone (e.g., "America/New_York"). Defaults to system timezone.',
      },
      format: {
        type: 'string',
        enum: ['iso', 'human', 'unix'],
        description: 'Output format. Defaults to "human".',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const format = (params.format as string) || 'human';
      const now = new Date();

      let timeString: string;
      switch (format) {
        case 'iso':
          timeString = now.toISOString();
          break;
        case 'unix':
          timeString = String(Math.floor(now.getTime() / 1000));
          break;
        case 'human':
        default:
          timeString = now.toLocaleString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short',
          });
      }

      logger.debug('Current time requested', { format, result: timeString });
      return {
        success: true,
        data: { time: timeString, timestamp: now.getTime() },
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  },
};

/**
 * System info tool - Get basic system information
 */
export const systemInfoTool: AgentTool = {
  name: 'get_system_info',
  description: 'Get basic system information like platform, memory, and uptime',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const os = await import('os');
      const info = {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptime: Math.floor(os.uptime() / 60) + ' minutes',
        totalMemory: Math.floor(os.totalmem() / (1024 * 1024 * 1024)) + ' GB',
        freeMemory: Math.floor(os.freemem() / (1024 * 1024 * 1024)) + ' GB',
        cpus: os.cpus().length + ' cores',
      };

      logger.debug('System info requested', info);
      return {
        success: true,
        data: info,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  },
};

/**
 * Calculator tool - Perform basic calculations
 */
export const calculatorTool: AgentTool = {
  name: 'calculator',
  description:
    'Perform basic mathematical calculations. Supports +, -, *, /, ^, sqrt, sin, cos, tan, log',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'Mathematical expression to evaluate (e.g., "2 + 2", "sqrt(16)", "10 * 5")',
      },
    },
    required: ['expression'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const expression = params.expression as string;

      // Security: Only allow safe mathematical operations
      const safeExpression = expression
        .replace(/\^/g, '**') // Convert ^ to **
        .replace(/sqrt/g, 'Math.sqrt')
        .replace(/sin/g, 'Math.sin')
        .replace(/cos/g, 'Math.cos')
        .replace(/tan/g, 'Math.tan')
        .replace(/log/g, 'Math.log')
        .replace(/abs/g, 'Math.abs')
        .replace(/pi/gi, 'Math.PI')
        .replace(/e(?![a-z])/gi, 'Math.E');

      // Validate: only allow numbers, operators, parentheses, Math functions
      const validPattern = /^[\d\s+\-*/().Math,sqrtsincogtanlgabePIE]+$/;
      if (!validPattern.test(safeExpression)) {
        return {
          success: false,
          error: 'Invalid expression. Only numbers and basic math operations are allowed.',
        };
      }

      // Evaluate in a controlled way
      // eslint-disable-next-line no-new-func
      const result = new Function(`"use strict"; return (${safeExpression})`)();

      logger.debug('Calculation performed', { expression, result });
      return {
        success: true,
        data: { expression, result: Number(result) },
      };
    } catch (error) {
      return {
        success: false,
        error: `Calculation error: ${(error as Error).message}`,
      };
    }
  },
};

/**
 * Get all built-in tools
 */
export function getBuiltInTools(): AgentTool[] {
  return [currentTimeTool, systemInfoTool, calculatorTool];
}

export default {
  currentTimeTool,
  systemInfoTool,
  calculatorTool,
  getBuiltInTools,
};
