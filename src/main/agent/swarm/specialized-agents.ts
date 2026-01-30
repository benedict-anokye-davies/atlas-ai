/**
 * @fileoverview Specialized Agents - Pre-built agent implementations
 * @module agent/swarm/specialized-agents
 * @author Atlas Team
 * @since 2.0.0
 *
 * @description
 * Ready-to-use specialized agents for common tasks:
 * - CoderAgent: Code generation, review, debugging
 * - ResearchAgent: Web research, analysis, summarization
 * - SystemAgent: System administration, DevOps tasks
 * - CreativeAgent: Content creation, design, writing
 * - DataAgent: Data analysis, visualization, SQL
 */

import { BaseAgent } from './base-agent';
import { AgentConfig, Task, TaskResult, AgentType } from './types';
import { createModuleLogger } from '../../utils/logger';
import { getLLMManager } from '../../llm/manager';
import { getCodeIntelligenceTools } from '../tools/code-intelligence';
import { getSearchTools } from '../tools/search';
import { getSystemCommandTools } from '../tools/system-commands';

const logger = createModuleLogger('SpecializedAgents');

// =============================================================================
// Coder Agent
// =============================================================================

/**
 * Specialized agent for coding tasks.
 *
 * Capabilities:
 * - Code generation and completion
 * - Code review and refactoring
 * - Debugging and error fixing
 * - Architecture design
 * - Testing and test generation
 */
export class CoderAgent extends BaseAgent {
  private llmManager = getLLMManager();
  private codeTools = getCodeIntelligenceTools();

  constructor(config?: Partial<AgentConfig>) {
    super({
      type: 'coder',
      name: 'Coder Agent',
      description: 'Specialized in software development, code review, and debugging',
      capabilities: [
        'code-generation',
        'code-review',
        'debugging',
        'refactoring',
        'architecture-design',
        'testing',
        'documentation',
      ],
      maxConcurrentTasks: 3,
      priority: 1,
      ...config,
    });
  }

  async execute(task: Task): Promise<TaskResult> {
    this.log('Executing coding task', { taskId: task.id, description: task.description });

    try {
      // Use LLM for code-related tasks
      const prompt = this.buildCodePrompt(task);
      const response = await this.llmManager.chat(prompt);

      return {
        success: true,
        taskId: task.id,
        output: response.content,
        data: {
          code: response.content,
          language: this.detectLanguage(task),
        },
        metadata: {
          agentId: this.id,
          agentType: this.type,
        },
      };
    } catch (error) {
      this.error('Coding task failed', error as Error, { taskId: task.id });

      return {
        success: false,
        taskId: task.id,
        error: (error as Error).message,
        output: null,
        data: null,
      };
    }
  }

  private buildCodePrompt(task: Task): string {
    return `
You are an expert software engineer. ${task.description}

${task.context ? `Context: ${JSON.stringify(task.context)}` : ''}

Please provide:
1. Clean, well-documented code
2. Explanation of the solution
3. Any assumptions made
4. Testing suggestions
`;
  }

  private detectLanguage(task: Task): string {
    const desc = task.description.toLowerCase();
    if (desc.includes('typescript') || desc.includes('ts')) return 'typescript';
    if (desc.includes('javascript') || desc.includes('js')) return 'javascript';
    if (desc.includes('python') || desc.includes('py')) return 'python';
    if (desc.includes('rust') || desc.includes('rs')) return 'rust';
    if (desc.includes('go ') || desc.includes('golang')) return 'go';
    if (desc.includes('java ')) return 'java';
    if (desc.includes('c++') || desc.includes('cpp')) return 'cpp';
    if (desc.includes('c#') || desc.includes('csharp')) return 'csharp';
    return 'unknown';
  }
}

// =============================================================================
// Research Agent
// =============================================================================

/**
 * Specialized agent for research tasks.
 *
 * Capabilities:
 * - Web search and information gathering
 * - Data analysis and synthesis
 * - Report generation
 * - Fact checking
 * - Trend analysis
 */
export class ResearchAgent extends BaseAgent {
  private llmManager = getLLMManager();
  private searchTools = getSearchTools();

  constructor(config?: Partial<AgentConfig>) {
    super({
      type: 'research',
      name: 'Research Agent',
      description: 'Specialized in web research, data analysis, and information synthesis',
      capabilities: [
        'web-search',
        'data-analysis',
        'report-generation',
        'fact-checking',
        'trend-analysis',
        'summarization',
        'comparison',
      ],
      maxConcurrentTasks: 5,
      priority: 2,
      ...config,
    });
  }

  async execute(task: Task): Promise<TaskResult> {
    this.log('Executing research task', { taskId: task.id, description: task.description });

    try {
      // Step 1: Search for information
      const searchResults = await this.performSearch(task);

      // Step 2: Analyze and synthesize
      const analysis = await this.analyzeResults(searchResults, task);

      return {
        success: true,
        taskId: task.id,
        output: analysis.summary,
        data: {
          sources: searchResults.sources,
          findings: analysis.findings,
          confidence: analysis.confidence,
        },
        metadata: {
          agentId: this.id,
          agentType: this.type,
        },
      };
    } catch (error) {
      this.error('Research task failed', error as Error, { taskId: task.id });

      return {
        success: false,
        taskId: task.id,
        error: (error as Error).message,
        output: null,
        data: null,
      };
    }
  }

  private async performSearch(task: Task): Promise<{ sources: string[]; content: string }> {
    // Use web search tool
    const searchQuery = task.description;

    // For now, return mock results
    // In production, this would use the actual search tools
    return {
      sources: ['web-search-results'],
      content: `Search results for: ${searchQuery}`,
    };
  }

  private async analyzeResults(
    searchResults: { sources: string[]; content: string },
    task: Task
  ): Promise<{ summary: string; findings: unknown[]; confidence: number }> {
    const prompt = `
Analyze the following research data and provide a comprehensive summary:

Task: ${task.description}
Search Results: ${searchResults.content}

Provide:
1. Executive summary (2-3 sentences)
2. Key findings (bullet points)
3. Confidence level (0-1)
`;

    const response = await this.llmManager.chat(prompt);

    return {
      summary: response.content,
      findings: [],
      confidence: 0.8,
    };
  }
}

// =============================================================================
// System Agent
// =============================================================================

/**
 * Specialized agent for system administration tasks.
 *
 * Capabilities:
 * - Command execution
 * - System monitoring
 * - Configuration management
 * - Deployment automation
 * - Troubleshooting
 */
export class SystemAgent extends BaseAgent {
  private systemTools = getSystemCommandTools();

  constructor(config?: Partial<AgentConfig>) {
    super({
      type: 'system',
      name: 'System Agent',
      description: 'Specialized in system administration, DevOps, and infrastructure management',
      capabilities: [
        'command-execution',
        'system-monitoring',
        'configuration-management',
        'deployment',
        'troubleshooting',
        'log-analysis',
        'process-management',
      ],
      maxConcurrentTasks: 2,
      priority: 3,
      ...config,
    });
  }

  async execute(task: Task): Promise<TaskResult> {
    this.log('Executing system task', { taskId: task.id, description: task.description });

    try {
      // Parse the system command from the task
      const command = this.parseCommand(task);

      // Execute using system tools
      // Note: In production, this would use the actual system command tools
      const result = await this.executeSystemCommand(command);

      return {
        success: result.success,
        taskId: task.id,
        output: result.output,
        data: result.data,
        metadata: {
          agentId: this.id,
          agentType: this.type,
        },
      };
    } catch (error) {
      this.error('System task failed', error as Error, { taskId: task.id });

      return {
        success: false,
        taskId: task.id,
        error: (error as Error).message,
        output: null,
        data: null,
      };
    }
  }

  private parseCommand(task: Task): string {
    // Extract command from task description
    // This is a simplified version
    return task.description;
  }

  private async executeSystemCommand(command: string): Promise<{
    success: boolean;
    output: string;
    data: unknown;
  }> {
    // In production, this would execute actual system commands
    // For now, return a mock result
    return {
      success: true,
      output: `Executed: ${command}`,
      data: { command, timestamp: Date.now() },
    };
  }
}

// =============================================================================
// Creative Agent
// =============================================================================

/**
 * Specialized agent for creative tasks.
 *
 * Capabilities:
 * - Content writing
 * - Copywriting
 * - Brainstorming
 * - Design concepts
 * - Storytelling
 */
export class CreativeAgent extends BaseAgent {
  private llmManager = getLLMManager();

  constructor(config?: Partial<AgentConfig>) {
    super({
      type: 'creative',
      name: 'Creative Agent',
      description: 'Specialized in content creation, writing, and creative problem-solving',
      capabilities: [
        'content-writing',
        'copywriting',
        'brainstorming',
        'design-concepts',
        'storytelling',
        'editing',
        'ideation',
      ],
      maxConcurrentTasks: 4,
      priority: 2,
      ...config,
    });
  }

  async execute(task: Task): Promise<TaskResult> {
    this.log('Executing creative task', { taskId: task.id, description: task.description });

    try {
      const prompt = this.buildCreativePrompt(task);
      const response = await this.llmManager.chat(prompt);

      return {
        success: true,
        taskId: task.id,
        output: response.content,
        data: {
          content: response.content,
          style: task.context?.style || 'professional',
        },
        metadata: {
          agentId: this.id,
          agentType: this.type,
        },
      };
    } catch (error) {
      this.error('Creative task failed', error as Error, { taskId: task.id });

      return {
        success: false,
        taskId: task.id,
        error: (error as Error).message,
        output: null,
        data: null,
      };
    }
  }

  private buildCreativePrompt(task: Task): string {
    return `
You are a creative professional. ${task.description}

${task.context ? `Additional context: ${JSON.stringify(task.context)}` : ''}

Create engaging, original content that captures the reader's attention.
`;
  }
}

// =============================================================================
// Data Agent
// =============================================================================

/**
 * Specialized agent for data tasks.
 *
 * Capabilities:
 * - Data analysis
 * - SQL queries
 * - Visualization
 * - Statistical analysis
 * - Data cleaning
 */
export class DataAgent extends BaseAgent {
  private llmManager = getLLMManager();

  constructor(config?: Partial<AgentConfig>) {
    super({
      type: 'data',
      name: 'Data Agent',
      description: 'Specialized in data analysis, SQL, and visualization',
      capabilities: [
        'data-analysis',
        'sql-queries',
        'visualization',
        'statistical-analysis',
        'data-cleaning',
        'etl',
        'reporting',
      ],
      maxConcurrentTasks: 3,
      priority: 2,
      ...config,
    });
  }

  async execute(task: Task): Promise<TaskResult> {
    this.log('Executing data task', { taskId: task.id, description: task.description });

    try {
      const prompt = this.buildDataPrompt(task);
      const response = await this.llmManager.chat(prompt);

      return {
        success: true,
        taskId: task.id,
        output: response.content,
        data: {
          analysis: response.content,
          query: task.context?.query,
        },
        metadata: {
          agentId: this.id,
          agentType: this.type,
        },
      };
    } catch (error) {
      this.error('Data task failed', error as Error, { taskId: task.id });

      return {
        success: false,
        taskId: task.id,
        error: (error as Error).message,
        output: null,
        data: null,
      };
    }
  }

  private buildDataPrompt(task: Task): string {
    return `
You are a data analyst. ${task.description}

${task.context ? `Data context: ${JSON.stringify(task.context)}` : ''}

Provide:
1. Clear analysis of the data
2. Key insights and patterns
3. SQL queries if applicable
4. Visualization recommendations
`;
  }
}

// =============================================================================
// Agent Factory
// =============================================================================

/**
 * Factory function to create agents by type.
 */
export function createAgent(type: AgentType, config?: Partial<AgentConfig>): BaseAgent {
  switch (type) {
    case 'coder':
      return new CoderAgent(config);
    case 'research':
      return new ResearchAgent(config);
    case 'system':
      return new SystemAgent(config);
    case 'creative':
      return new CreativeAgent(config);
    case 'data':
      return new DataAgent(config);
    default:
      throw new Error(`Unknown agent type: ${type}`);
  }
}

// All agents are already exported above as part of their class declarations
