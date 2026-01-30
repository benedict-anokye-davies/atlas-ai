#!/usr/bin/env node
/**
 * Atlas CLI - Standalone terminal interface with direct tool execution
 * 
 * Run with: npm run atlas-cli
 * 
 * Uses Fireworks AI API for LLM with tool calling.
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ANSI colors
const c = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
};

function print(text: string, color = '') {
    console.log(color ? `${color}${text}${c.reset}` : text);
}

// Tool definitions for file operations
const FILE_TOOLS = [
    {
        type: 'function' as const,
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
        type: 'function' as const,
        function: {
            name: 'list_directory',
            description: 'List files and directories in a path',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to the directory' },
                    recursive: { type: 'boolean', description: 'Whether to list recursively' },
                },
                required: ['path'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'create_file',
            description: 'Create a new file with specified content',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path for the new file' },
                    content: { type: 'string', description: 'Content to write to the file' },
                },
                required: ['path', 'content'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'edit_file',
            description: 'Edit a file by replacing old text with new text',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to the file' },
                    old_text: { type: 'string', description: 'Text to find and replace' },
                    new_text: { type: 'string', description: 'Text to replace with' },
                },
                required: ['path', 'old_text', 'new_text'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'grep_search',
            description: 'Search for a pattern in files',
            parameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'Pattern to search for' },
                    path: { type: 'string', description: 'Directory to search in' },
                },
                required: ['pattern', 'path'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'run_command',
            description: 'Execute a shell command',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Command to execute' },
                    cwd: { type: 'string', description: 'Working directory (optional)' },
                },
                required: ['command'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'get_system_info',
            description: 'Get system information like OS, memory, etc.',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    },
];

// Tool implementations
async function executeTool(name: string, args: Record<string, any>): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
        switch (name) {
            case 'read_file': {
                const filePath = args.path;
                if (!fs.existsSync(filePath)) {
                    return { success: false, error: `File not found: ${filePath}` };
                }
                const content = fs.readFileSync(filePath, 'utf-8');
                return { success: true, data: { content, lines: content.split('\n').length } };
            }

            case 'list_directory': {
                const dirPath = args.path || '.';
                if (!fs.existsSync(dirPath)) {
                    return { success: false, error: `Directory not found: ${dirPath}` };
                }
                const entries = fs.readdirSync(dirPath, { withFileTypes: true });
                const items = entries.slice(0, 50).map(e => ({
                    name: e.name,
                    type: e.isDirectory() ? 'directory' : 'file',
                }));
                return { success: true, data: { entries: items, total: entries.length } };
            }

            case 'create_file': {
                const filePath = args.path;
                const content = args.content || '';
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(filePath, content, 'utf-8');
                return { success: true, data: { created: filePath } };
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

            case 'grep_search': {
                const { execSync } = await import('child_process');
                const pattern = args.pattern;
                const searchPath = args.path || '.';
                try {
                    const result = execSync(`findstr /s /i /n "${pattern}" "${searchPath}\\*"`, {
                        encoding: 'utf-8',
                        maxBuffer: 1024 * 1024,
                    });
                    return { success: true, data: result.slice(0, 2000) };
                } catch {
                    return { success: true, data: 'No matches found' };
                }
            }

            case 'run_command': {
                const { execSync } = await import('child_process');
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

            case 'get_system_info': {
                return {
                    success: true,
                    data: {
                        platform: os.platform(),
                        arch: os.arch(),
                        hostname: os.hostname(),
                        totalMemory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB`,
                        freeMemory: `${Math.round(os.freemem() / 1024 / 1024 / 1024)} GB`,
                        cpus: os.cpus().length,
                        cwd: process.cwd(),
                    },
                };
            }

            default:
                return { success: false, error: `Unknown tool: ${name}` };
        }
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

// Load API key from .env or environment
function getApiKey(): string {
    // Try environment variable first
    if (process.env.FIREWORKS_API_KEY) {
        return process.env.FIREWORKS_API_KEY;
    }

    // Try .env file
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const match = envContent.match(/FIREWORKS_API_KEY=(.+)/);
        if (match) {
            return match[1].trim();
        }
    }

    throw new Error('FIREWORKS_API_KEY not found in environment or .env file');
}

async function callLLM(messages: any[], tools: any[]): Promise<any> {
    const apiKey = getApiKey();

    // Fireworks API endpoint
    const response = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            // Using Llama 3.3 70B which has good tool calling support
            model: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
            messages,
            tools,
            tool_choice: 'auto',
            max_tokens: 4096,
            temperature: 0.7,
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Fireworks API error: ${response.status} - ${error}`);
    }

    return response.json();
}

async function chat(userMessage: string, history: any[]): Promise<{ response: string; history: any[] }> {
    history.push({ role: 'user', content: userMessage });

    const systemMessage = {
        role: 'system',
        content: `You are Atlas, a powerful AI coding assistant with access to file system tools. You can:
- Read and analyze files
- Create and edit files  
- Search for patterns in code
- Run shell commands
- Get system information

Current working directory: ${process.cwd()}

When the user asks about files, code, or system operations, USE THE TOOLS. Be helpful, concise, and action-oriented.`,
    };

    let iterations = 0;
    const maxIterations = 10;

    while (iterations < maxIterations) {
        iterations++;

        const result = await callLLM([systemMessage, ...history], FILE_TOOLS);
        const choice = result.choices?.[0];

        if (!choice) {
            throw new Error('No response from LLM');
        }

        const message = choice.message;

        // Check for tool calls
        if (message.tool_calls && message.tool_calls.length > 0) {
            // Add assistant message with tool calls
            history.push({
                role: 'assistant',
                content: message.content || '',
                tool_calls: message.tool_calls,
            });

            // Execute each tool
            for (const toolCall of message.tool_calls) {
                const toolName = toolCall.function.name;
                let toolArgs: Record<string, any> = {};
                try {
                    toolArgs = JSON.parse(toolCall.function.arguments || '{}');
                } catch { }

                print(`  ${c.yellow}⚡ ${toolName}${c.reset}`);
                if (Object.keys(toolArgs).length > 0) {
                    print(`     ${c.dim}${JSON.stringify(toolArgs).slice(0, 80)}${c.reset}`);
                }

                const result = await executeTool(toolName, toolArgs);

                if (result.success) {
                    print(`  ${c.green}✓ Done${c.reset}`);
                } else {
                    print(`  ${c.red}✗ ${result.error}${c.reset}`);
                }

                // Add tool result
                history.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: result.success
                        ? (typeof result.data === 'string' ? result.data : JSON.stringify(result.data))
                        : `Error: ${result.error}`,
                });
            }

            // Continue to process tool results
            continue;
        }

        // No tool calls - final response
        const response = message.content || '';
        history.push({ role: 'assistant', content: response });

        return { response, history };
    }

    return { response: 'Max iterations reached', history };
}

async function main() {
    console.clear();
    print('╔════════════════════════════════════════════════════════════╗', c.cyan);
    print('║                    🤖 ATLAS CLI                             ║', c.cyan);
    print('║          Powered by Fireworks AI (Llama 3.3 70B)           ║', c.cyan);
    print('╚════════════════════════════════════════════════════════════╝', c.cyan);
    print('');
    print(`Working directory: ${c.dim}${process.cwd()}${c.reset}`);
    print('');
    print('Commands:', c.yellow);
    print(`  ${c.cyan}/tools${c.reset} - Show available tools`);
    print(`  ${c.cyan}/clear${c.reset} - Clear history`);
    print(`  ${c.cyan}/exit${c.reset}  - Exit`);
    print('');

    // Verify API key
    try {
        getApiKey();
        print(`${c.green}✓ Fireworks API key found${c.reset}`);
    } catch (error: any) {
        print(`${c.red}✗ ${error.message}${c.reset}`);
        print(`${c.dim}Add FIREWORKS_API_KEY to your .env file${c.reset}`);
        process.exit(1);
    }

    print('');

    let history: any[] = [];

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const prompt = () => {
        rl.question(`${c.cyan}You:${c.reset} `, async (input) => {
            const trimmed = input.trim();

            if (!trimmed) {
                prompt();
                return;
            }

            if (trimmed === '/exit' || trimmed === '/quit') {
                print('\nGoodbye! 👋', c.cyan);
                process.exit(0);
            }

            if (trimmed === '/clear') {
                history = [];
                print('History cleared.', c.green);
                prompt();
                return;
            }

            if (trimmed === '/tools') {
                print('\nAvailable Tools:', c.cyan);
                for (const tool of FILE_TOOLS) {
                    print(`  ${c.yellow}${tool.function.name}${c.reset} - ${tool.function.description}`);
                }
                print('');
                prompt();
                return;
            }

            print('');

            try {
                const result = await chat(trimmed, history);
                history = result.history;
                print(`${c.magenta}Atlas:${c.reset} ${result.response}`);
            } catch (error: any) {
                print(`${c.red}Error: ${error.message}${c.reset}`);
            }

            print('');
            prompt();
        });
    };

    prompt();
}

main().catch(console.error);
