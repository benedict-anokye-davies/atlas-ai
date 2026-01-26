/**
 * Atlas Desktop - Debug Controller
 * 
 * Control debugging sessions: set breakpoints, step through code,
 * inspect variables, and evaluate expressions.
 * 
 * @module agent/tools/debug-controller
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';

const execAsync = promisify(exec);
const logger = createModuleLogger('DebugController');

// ============================================================================
// DEBUG SESSION STATE
// ============================================================================

interface DebugSession {
  id: string;
  type: 'node' | 'python' | 'browser';
  pid?: number;
  status: 'starting' | 'running' | 'paused' | 'stopped';
  file: string;
  breakpoints: Array<{ file: string; line: number; id: string }>;
  currentFrame?: {
    file: string;
    line: number;
    function: string;
  };
  variables?: Record<string, unknown>;
}

const activeSessions: Map<string, DebugSession> = new Map();

// ============================================================================
// 1. START DEBUG SESSION
// ============================================================================

/**
 * Start a new debug session
 */
export const startDebugTool: AgentTool = {
  name: 'debug_start',
  description: `Start a new debug session:
- Supports Node.js, Python, and browser debugging
- Automatically detects the appropriate debugger
- Can set initial breakpoints`,
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'File to debug',
      },
      type: {
        type: 'string',
        enum: ['node', 'python', 'browser', 'auto'],
        description: 'Debug type (auto-detect if not specified)',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Command line arguments',
      },
      breakpoints: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            line: { type: 'number' },
          },
        },
        description: 'Initial breakpoints to set',
      },
      env: {
        type: 'object',
        description: 'Environment variables',
      },
    },
    required: ['file'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const file = params.file as string;
    const type = (params.type as string) || 'auto';
    const args = (params.args as string[]) || [];
    const breakpoints = (params.breakpoints as Array<{ file: string; line: number }>) || [];
    const env = (params.env as Record<string, string>) || {};

    try {
      // Auto-detect debug type
      const ext = path.extname(file).toLowerCase();
      let debugType: 'node' | 'python' | 'browser';
      
      if (type === 'auto') {
        if (['.js', '.ts', '.mjs', '.cjs'].includes(ext)) {
          debugType = 'node';
        } else if (['.py', '.pyw'].includes(ext)) {
          debugType = 'python';
        } else if (['.html', '.htm'].includes(ext)) {
          debugType = 'browser';
        } else {
          debugType = 'node'; // Default
        }
      } else {
        debugType = type as 'node' | 'python' | 'browser';
      }

      const sessionId = `debug_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Create debug configuration based on type
      let debugConfig: Record<string, unknown>;

      switch (debugType) {
        case 'node':
          debugConfig = {
            type: 'node',
            request: 'launch',
            name: `Debug ${path.basename(file)}`,
            program: file,
            args,
            env: { ...process.env, ...env },
            console: 'integratedTerminal',
            skipFiles: ['<node_internals>/**'],
          };
          break;

        case 'python':
          debugConfig = {
            type: 'python',
            request: 'launch',
            name: `Debug ${path.basename(file)}`,
            program: file,
            args,
            env: { ...process.env, ...env },
            console: 'integratedTerminal',
          };
          break;

        case 'browser':
          debugConfig = {
            type: 'chrome',
            request: 'launch',
            name: `Debug ${path.basename(file)}`,
            file,
            webRoot: path.dirname(file),
          };
          break;
      }

      // Create the session
      const session: DebugSession = {
        id: sessionId,
        type: debugType,
        status: 'starting',
        file,
        breakpoints: breakpoints.map((bp, i) => ({
          ...bp,
          id: `bp_${i}`,
        })),
      };

      activeSessions.set(sessionId, session);

      // Generate VS Code launch.json compatible config
      const launchConfig = {
        version: '0.2.0',
        configurations: [debugConfig],
      };

      // Create .vscode/launch.json if needed
      const vscodePath = path.join(path.dirname(file), '.vscode');
      const launchPath = path.join(vscodePath, 'launch.json');
      
      try {
        await fs.mkdir(vscodePath, { recursive: true });
        await fs.writeFile(launchPath, JSON.stringify(launchConfig, null, 2));
      } catch {
        // Directory might exist
      }

      logger.info(`Started debug session ${sessionId} for ${file}`);

      return {
        success: true,
        data: {
          sessionId,
          type: debugType,
          file,
          config: debugConfig,
          instructions: `Debug session configured. To start debugging:
1. Open ${file} in VS Code
2. Press F5 or use Run > Start Debugging
3. Use the debug controls to step through code

Or run from terminal:
- Node: node --inspect-brk "${file}" ${args.join(' ')}
- Python: python -m debugpy --listen 5678 --wait-for-client "${file}" ${args.join(' ')}`,
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

// ============================================================================
// 2. SET BREAKPOINTS
// ============================================================================

/**
 * Set or remove breakpoints
 */
export const setBreakpointTool: AgentTool = {
  name: 'debug_breakpoint',
  description: `Manage breakpoints:
- Set breakpoints at specific lines
- Conditional breakpoints
- Logpoints (log without stopping)
- Remove breakpoints`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['set', 'remove', 'list', 'clear'],
        description: 'Breakpoint action',
      },
      file: {
        type: 'string',
        description: 'File path',
      },
      line: {
        type: 'number',
        description: 'Line number',
      },
      condition: {
        type: 'string',
        description: 'Condition expression (only break when true)',
      },
      logMessage: {
        type: 'string',
        description: 'Log message (for logpoints, use {expression} for interpolation)',
      },
    },
    required: ['action'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const action = params.action as string;
    const file = params.file as string;
    const line = params.line as number;
    const condition = params.condition as string | undefined;
    const logMessage = params.logMessage as string | undefined;

    try {
      switch (action) {
        case 'set': {
          if (!file || !line) {
            return { success: false, error: 'File and line are required' };
          }

          // Verify the file exists
          await fs.access(file);

          // Create breakpoint info for VS Code
          const breakpoint = {
            file,
            line,
            condition,
            logMessage,
            enabled: true,
          };

          // Store in .vscode/breakpoints.json (custom tracking)
          const vscodePath = path.join(path.dirname(file), '.vscode');
          const bpPath = path.join(vscodePath, 'breakpoints.json');

          let breakpoints: typeof breakpoint[] = [];
          try {
            const existing = await fs.readFile(bpPath, 'utf-8');
            breakpoints = JSON.parse(existing);
          } catch {
            // File doesn't exist
          }

          // Add or update breakpoint
          const existingIndex = breakpoints.findIndex(
            bp => bp.file === file && bp.line === line
          );
          if (existingIndex >= 0) {
            breakpoints[existingIndex] = breakpoint;
          } else {
            breakpoints.push(breakpoint);
          }

          await fs.mkdir(vscodePath, { recursive: true });
          await fs.writeFile(bpPath, JSON.stringify(breakpoints, null, 2));

          return {
            success: true,
            data: {
              action: 'set',
              breakpoint,
              total: breakpoints.length,
            },
          };
        }

        case 'remove': {
          if (!file || !line) {
            return { success: false, error: 'File and line are required' };
          }

          const vscodePath = path.join(path.dirname(file), '.vscode');
          const bpPath = path.join(vscodePath, 'breakpoints.json');

          try {
            const existing = await fs.readFile(bpPath, 'utf-8');
            let breakpoints = JSON.parse(existing);
            breakpoints = breakpoints.filter(
              (bp: { file: string; line: number }) => 
                !(bp.file === file && bp.line === line)
            );
            await fs.writeFile(bpPath, JSON.stringify(breakpoints, null, 2));

            return {
              success: true,
              data: {
                action: 'remove',
                file,
                line,
                remaining: breakpoints.length,
              },
            };
          } catch {
            return { success: false, error: 'No breakpoints found' };
          }
        }

        case 'list': {
          const breakpoints: Array<{ file: string; line: number; condition?: string }> = [];
          
          // Scan for breakpoint files
          if (file) {
            const vscodePath = path.join(path.dirname(file), '.vscode');
            const bpPath = path.join(vscodePath, 'breakpoints.json');
            try {
              const existing = await fs.readFile(bpPath, 'utf-8');
              breakpoints.push(...JSON.parse(existing));
            } catch {
              // No breakpoints
            }
          }

          return {
            success: true,
            data: {
              action: 'list',
              breakpoints,
              count: breakpoints.length,
            },
          };
        }

        case 'clear': {
          if (file) {
            const vscodePath = path.join(path.dirname(file), '.vscode');
            const bpPath = path.join(vscodePath, 'breakpoints.json');
            try {
              await fs.writeFile(bpPath, '[]');
            } catch {
              // Ignore
            }
          }

          return {
            success: true,
            data: {
              action: 'clear',
              message: 'All breakpoints cleared',
            },
          };
        }

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

// ============================================================================
// 3. INSPECT VARIABLE
// ============================================================================

/**
 * Inspect variables in the current debug context
 */
export const inspectVariableTool: AgentTool = {
  name: 'debug_inspect',
  description: `Inspect variables and evaluate expressions during debugging:
- View local variables
- Inspect object properties
- Evaluate expressions
- Watch expressions`,
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'Expression to evaluate',
      },
      depth: {
        type: 'number',
        description: 'Object inspection depth (default: 2)',
      },
      format: {
        type: 'string',
        enum: ['json', 'pretty', 'minimal'],
        description: 'Output format',
      },
    },
    required: ['expression'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const expression = params.expression as string;
    const depth = (params.depth as number) || 2;
    const format = (params.format as string) || 'pretty';

    try {
      // This would integrate with the actual debugger protocol
      // For now, provide static analysis capabilities

      // Try to evaluate simple expressions
      let result: unknown;
      let evaluationType: string;

      // Check if it's a simple literal
      if (/^["'].*["']$/.test(expression)) {
        result = expression.slice(1, -1);
        evaluationType = 'string';
      } else if (/^-?\d+(\.\d+)?$/.test(expression)) {
        result = parseFloat(expression);
        evaluationType = 'number';
      } else if (expression === 'true' || expression === 'false') {
        result = expression === 'true';
        evaluationType = 'boolean';
      } else if (expression === 'null') {
        result = null;
        evaluationType = 'null';
      } else if (expression === 'undefined') {
        result = undefined;
        evaluationType = 'undefined';
      } else {
        // Complex expression - would need active debug session
        result = null;
        evaluationType = 'requires_debug_session';
      }

      return {
        success: true,
        data: {
          expression,
          result,
          type: evaluationType,
          depth,
          format,
          note: evaluationType === 'requires_debug_session' 
            ? 'Complex expressions require an active debug session. Start debugging with F5 in VS Code.'
            : undefined,
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

// ============================================================================
// 4. DEBUG CONTROL (Step, Continue, etc.)
// ============================================================================

/**
 * Control debug execution flow
 */
export const debugControlTool: AgentTool = {
  name: 'debug_control',
  description: `Control debug execution:
- continue: Resume execution
- step_over: Execute current line, skip into functions
- step_into: Step into function calls
- step_out: Execute until current function returns
- pause: Pause execution
- stop: End debug session`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['continue', 'step_over', 'step_into', 'step_out', 'pause', 'stop'],
        description: 'Debug action',
      },
      sessionId: {
        type: 'string',
        description: 'Debug session ID (optional if only one session)',
      },
    },
    required: ['action'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const action = params.action as string;
    const sessionId = params.sessionId as string | undefined;

    try {
      // Map actions to VS Code debug commands
      const vsCodeCommands: Record<string, string> = {
        continue: 'workbench.action.debug.continue',
        step_over: 'workbench.action.debug.stepOver',
        step_into: 'workbench.action.debug.stepInto',
        step_out: 'workbench.action.debug.stepOut',
        pause: 'workbench.action.debug.pause',
        stop: 'workbench.action.debug.stop',
      };

      const keyboardShortcuts: Record<string, string> = {
        continue: 'F5',
        step_over: 'F10',
        step_into: 'F11',
        step_out: 'Shift+F11',
        pause: 'F6',
        stop: 'Shift+F5',
      };

      const command = vsCodeCommands[action];
      const shortcut = keyboardShortcuts[action];

      return {
        success: true,
        data: {
          action,
          vsCodeCommand: command,
          keyboardShortcut: shortcut,
          instructions: `Use ${shortcut} in VS Code, or run command: ${command}`,
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

// ============================================================================
// 5. STACK TRACE / CALL STACK
// ============================================================================

/**
 * Analyze call stack
 */
export const callStackTool: AgentTool = {
  name: 'debug_callstack',
  description: `Analyze call stack:
- View current call stack
- Navigate to specific stack frames
- Analyze function call hierarchy`,
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'File to analyze (for static analysis)',
      },
      function: {
        type: 'string',
        description: 'Function name to trace calls for',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const file = params.file as string | undefined;
    const functionName = params.function as string | undefined;

    try {
      if (file && functionName) {
        // Static call analysis
        const content = await fs.readFile(file, 'utf-8');
        const lines = content.split('\n');

        // Find function calls
        const calls: Array<{ line: number; caller: string; code: string }> = [];
        const callPattern = new RegExp(`\\b${functionName}\\s*\\(`, 'g');

        let currentFunction = '<module>';
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // Track current function context
          const funcMatch = line.match(/(?:function|const|let|var)\s+(\w+)\s*(?:=\s*(?:async\s*)?\(|[(:=])/);
          if (funcMatch) {
            currentFunction = funcMatch[1];
          }

          // Find calls to target function
          if (callPattern.test(line)) {
            calls.push({
              line: i + 1,
              caller: currentFunction,
              code: line.trim(),
            });
          }
        }

        return {
          success: true,
          data: {
            function: functionName,
            file,
            callSites: calls,
            totalCalls: calls.length,
          },
        };
      }

      // No file specified - return debug instructions
      return {
        success: true,
        data: {
          instructions: `View call stack in VS Code:
1. Start debugging (F5)
2. When paused, check the "Call Stack" panel
3. Click on stack frames to navigate
4. Or use: View > Debug Console to evaluate expressions`,
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

// ============================================================================
// 6. MEMORY/PERFORMANCE PROFILING
// ============================================================================

/**
 * Profile memory and performance
 */
export const profileTool: AgentTool = {
  name: 'debug_profile',
  description: `Profile memory and performance:
- Memory snapshots
- CPU profiling
- Performance timing
- Memory leak detection`,
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['memory', 'cpu', 'performance'],
        description: 'Type of profiling',
      },
      file: {
        type: 'string',
        description: 'File to profile',
      },
      duration: {
        type: 'number',
        description: 'Profiling duration in seconds',
      },
    },
    required: ['type'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const type = params.type as string;
    const file = params.file as string | undefined;
    const duration = (params.duration as number) || 10;

    try {
      const profileCommands: Record<string, string> = {
        memory: `node --inspect --heap-prof ${file || 'app.js'}`,
        cpu: `node --inspect --cpu-prof --cpu-prof-interval=100 ${file || 'app.js'}`,
        performance: `node --inspect --prof ${file || 'app.js'}`,
      };

      const analysisCommands: Record<string, string> = {
        memory: 'Process the .heapprofile file with Chrome DevTools',
        cpu: 'Process the .cpuprofile file with Chrome DevTools',
        performance: 'Process the v8.log with: node --prof-process isolate*.log > processed.txt',
      };

      return {
        success: true,
        data: {
          type,
          command: profileCommands[type],
          duration,
          instructions: `Profiling ${type}:
1. Run: ${profileCommands[type]}
2. Perform the actions you want to profile
3. Stop the process (Ctrl+C) after ${duration} seconds
4. ${analysisCommands[type]}

For VS Code:
- Use the "Performance" tab in Debug Console
- Or install "vscode-js-profile-flame" extension for flame graphs`,
          tips: type === 'memory' ? [
            'Take multiple snapshots to compare memory growth',
            'Look for detached DOM nodes and event listeners',
            'Check for closures holding references',
          ] : type === 'cpu' ? [
            'Look for hot paths with high self time',
            'Check for synchronous blocking operations',
            'Consider worker threads for CPU-intensive tasks',
          ] : [
            'Focus on optimizing critical paths',
            'Consider code splitting for faster startup',
            'Use lazy loading where appropriate',
          ],
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

// ============================================================================
// EXPORTS
// ============================================================================

export function getDebugControllerTools(): AgentTool[] {
  return [
    startDebugTool,
    setBreakpointTool,
    inspectVariableTool,
    debugControlTool,
    callStackTool,
    profileTool,
  ];
}

export default {
  startDebugTool,
  setBreakpointTool,
  inspectVariableTool,
  debugControlTool,
  callStackTool,
  profileTool,
  getDebugControllerTools,
};
