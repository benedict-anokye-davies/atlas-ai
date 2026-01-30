/**
 * Atlas Desktop - Simple Chat with Tools
 * 
 * Direct text chat → LLM → Tool execution → Response
 * No complex pipelines - just clean, simple flow.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { getLLMManager } from '../llm/manager';
import { createModuleLogger } from '../utils/logger';
import { sendToRenderer } from '../ipc/handlers';
import type { ConversationContext, ChatMessage, LLMToolDefinition, ChatOptions } from '../../shared/types/llm';

const logger = createModuleLogger('SimpleChatTools');

// ==================== TOOL DEFINITIONS ====================

const TOOLS: LLMToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the contents of a file at the specified path',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to the file to read' },
                },
                required: ['path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_directory',
            description: 'List files and directories in a path',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to the directory' },
                },
                required: ['path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'create_file',
            description: 'Create a new file with specified content',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path for the new file' },
                    content: { type: 'string', description: 'Content to write' },
                },
                required: ['path', 'content'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'edit_file',
            description: 'Edit a file by replacing text',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to the file' },
                    old_text: { type: 'string', description: 'Text to find' },
                    new_text: { type: 'string', description: 'Replacement text' },
                },
                required: ['path', 'old_text', 'new_text'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'search_files',
            description: 'Search for a pattern in files',
            parameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'Pattern to search for' },
                    directory: { type: 'string', description: 'Directory to search in' },
                },
                required: ['pattern', 'directory'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'run_command',
            description: 'Execute a shell command',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Command to run' },
                    cwd: { type: 'string', description: 'Working directory (optional)' },
                },
                required: ['command'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_system_info',
            description: 'Get system information',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    },
];

// ==================== TOOL EXECUTION ====================

async function executeTool(name: string, args: Record<string, any>): Promise<{ success: boolean; data?: any; error?: string }> {
    logger.info(`Executing tool: ${name}`, { args });

    try {
        switch (name) {
            case 'read_file': {
                const filePath = args.path;
                if (!fs.existsSync(filePath)) {
                    return { success: false, error: `File not found: ${filePath}` };
                }
                const stat = fs.statSync(filePath);
                if (stat.isDirectory()) {
                    return { success: false, error: `Path is a directory: ${filePath}` };
                }
                const content = fs.readFileSync(filePath, 'utf-8');
                return { success: true, data: { content, lines: content.split('\n').length, size: stat.size } };
            }

            case 'list_directory': {
                const dirPath = args.path || process.cwd();
                if (!fs.existsSync(dirPath)) {
                    return { success: false, error: `Directory not found: ${dirPath}` };
                }
                const entries = fs.readdirSync(dirPath, { withFileTypes: true });
                const items = entries.slice(0, 100).map(e => ({
                    name: e.name,
                    type: e.isDirectory() ? 'dir' : 'file',
                }));
                return { success: true, data: { path: dirPath, entries: items, total: entries.length } };
            }

            case 'create_file': {
                const filePath = args.path;
                const content = args.content || '';
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(filePath, content, 'utf-8');
                return { success: true, data: { created: filePath, bytes: content.length } };
            }

            case 'edit_file': {
                const filePath = args.path;
                if (!fs.existsSync(filePath)) {
                    return { success: false, error: `File not found: ${filePath}` };
                }
                const content = fs.readFileSync(filePath, 'utf-8');
                if (!content.includes(args.old_text)) {
                    return { success: false, error: 'Old text not found in file' };
                }
                const newContent = content.replace(args.old_text, args.new_text);
                fs.writeFileSync(filePath, newContent, 'utf-8');
                return { success: true, data: { edited: filePath } };
            }

            case 'search_files': {
                const pattern = args.pattern;
                const dir = args.directory || process.cwd();
                try {
                    const result = execSync(`findstr /s /i /n "${pattern}" "${dir}\\*"`, {
                        encoding: 'utf-8',
                        maxBuffer: 1024 * 1024,
                        timeout: 30000,
                    });
                    return { success: true, data: result.slice(0, 3000) };
                } catch {
                    return { success: true, data: 'No matches found' };
                }
            }

            case 'run_command': {
                const command = args.command;
                const cwd = args.cwd || process.cwd();
                try {
                    const result = execSync(command, {
                        encoding: 'utf-8',
                        cwd,
                        maxBuffer: 1024 * 1024,
                        timeout: 30000,
                    });
                    return { success: true, data: result };
                } catch (error: any) {
                    return { success: false, error: error.message };
                }
            }

            case 'get_system_info':
                return {
                    success: true,
                    data: {
                        platform: os.platform(),
                        arch: os.arch(),
                        hostname: os.hostname(),
                        memory: `${Math.round(os.freemem() / 1024 / 1024 / 1024)}/${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB`,
                        cpus: os.cpus().length,
                        cwd: process.cwd(),
                    },
                };

            default:
                return { success: false, error: `Unknown tool: ${name}` };
        }
    } catch (error: any) {
        logger.error(`Tool execution failed: ${name}`, { error: error.message });
        return { success: false, error: error.message };
    }
}

// ==================== CHAT WITH TOOLS ====================

// Conversation context (maintained between calls)
let conversationContext: ConversationContext | null = null;

/**
 * Simple chat with tools - direct flow, no pipelines
 */
export async function chatWithTools(userMessage: string): Promise<string> {
    const llm = getLLMManager();

    // Create or get conversation context
    if (!conversationContext) {
        conversationContext = llm.createContext('Ben');
    }

    // Add user message to context
    conversationContext.messages.push({
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
    });
    conversationContext.updatedAt = Date.now();

    let iterations = 0;
    const maxIterations = 10;
    const chatOptions: ChatOptions = {
        tools: TOOLS,
        tool_choice: 'auto',
    };

    while (iterations < maxIterations) {
        iterations++;

        // Call LLM with tools
        const response = await llm.chat(userMessage, conversationContext, chatOptions);

        // Check for tool calls
        if (response.toolCalls && response.toolCalls.length > 0) {
            // Add assistant message with tool calls to context
            conversationContext.messages.push({
                role: 'assistant',
                content: response.content || '',
                tool_calls: response.toolCalls,
                timestamp: Date.now(),
            });

            // Execute each tool
            for (const toolCall of response.toolCalls) {
                const toolName = toolCall.function.name;
                let toolArgs: Record<string, any> = {};
                try {
                    toolArgs = JSON.parse(toolCall.function.arguments || '{}');
                } catch { }

                // Notify UI about tool call
                sendToRenderer('atlas:tool-call', {
                    id: toolCall.id,
                    name: toolName,
                    status: 'running',
                    args: toolArgs,
                });

                logger.info(`[Tool] Executing: ${toolName}`);
                const result = await executeTool(toolName, toolArgs);

                // Notify UI about result
                sendToRenderer('atlas:tool-call', {
                    id: toolCall.id,
                    name: toolName,
                    status: result.success ? 'complete' : 'error',
                    result: result.success ? result.data : result.error,
                });

                // Add tool result to context
                const toolResultContent = result.success
                    ? (typeof result.data === 'string' ? result.data : JSON.stringify(result.data))
                    : `Error: ${result.error}`;

                conversationContext.messages.push({
                    role: 'tool',
                    content: toolResultContent,
                    tool_call_id: toolCall.id,
                    timestamp: Date.now(),
                });

                // Update the user message for next iteration to include tool context
                userMessage = `[Tool ${toolName} returned: ${toolResultContent.slice(0, 500)}]\n\nContinue responding to the user based on this information.`;
            }

            // Continue loop to process tool results
            continue;
        }

        // No tool calls - final response
        const finalResponse = response.content || '';

        // Add to context
        conversationContext.messages.push({
            role: 'assistant',
            content: finalResponse,
            timestamp: Date.now(),
        });

        return finalResponse;
    }

    return 'Max tool iterations reached';
}

/**
 * Clear conversation history
 */
export function clearHistory(): void {
    conversationContext = null;
    logger.info('Conversation history cleared');
}

/**
 * Get available tools for UI display
 */
export function getAvailableTools(): string[] {
    return TOOLS.map(t => t.function.name);
}
