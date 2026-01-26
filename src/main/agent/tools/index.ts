/**
 * Atlas Desktop - Agent Tools Index
 *
 * Central registry for all agent tools. Tools are organized by category
 * and provide various capabilities for file operations, terminal commands,
 * browser automation, and more.
 *
 * @module agent/tools
 *
 * @example
 * ```typescript
 * import { getAllTools, getToolByName, getToolsByCategory } from './tools';
 *
 * // Get all available tools
 * const tools = getAllTools();
 *
 * // Get a specific tool by name
 * const readFile = getToolByName('file_read');
 *
 * // Get all filesystem tools
 * const fsTools = getToolsByCategory('filesystem');
 * ```
 */

// Re-export all tools from each category
export * from './filesystem';
export * from './terminal';
export * from './browser';
export * from './screenshot';
export * from './screenshot-analyzer';
export * from './clipboard';
// Note: websearch.ts has duplicate exports (webSearchTool, fetchUrlTool) with search.ts
// search.ts uses fetch() which is cleaner, so we use that instead
export * from './search';
export * from './git';
export * from './git-diff';
export * from './git-commit-gen';
export * from './git-cleanup';
export * from './git-pr';
export * from './git-bisect';
export * from './system-commands';
export * from './app-launcher';
export * from './mouse-keyboard';
export * from './media-control';
export * from './window-manager';
export * from './screen-vision';
export * from './phone';
export * from './browser-cdp';
export * from './spotify';
export * from './vscode';
export * from './discord';
export * from './explorer';
export * from '../../integrations/bookmarks';
export * from './trading';
export * from './finance';
export * from './template-matching';
export * from './calendar';
export * from './email';
export * from './code-intelligence';
export * from './code-analysis';
export * from './code-refactor';
export * from './debug-controller';
export * from './doc-generator';
export * from './scaffolding';
export * from './multi-file-editor';
export * from './vscode-deep';
export * from './code-explain';
export * from './perplexity-research';
export * from './image-generation';
export * from './vision-analysis';
// Browser Agent - Advanced AI-powered browser automation
export * from '../browser-agent/tools';
// Business tools - CRM, projects, time tracking, invoicing, expenses, pipeline
export * from './business';
// OCR tools - import selectively to avoid OCRResult conflict with screen-vision
export {
  getOCRTools,
  getOCRManager,
  shutdownOCR,
  extractTextFromImageTool,
  extractTextFromScreenshotTool,
  findTextInImageTool,
  listOCRLanguagesTool,
  ocrExtractScreenTool,
  ocrExtractRegionTool,
  ocrExtractTextTool,
  OCRManager,
} from './ocr';

import { AgentTool } from '../../../shared/types/agent';
import { getFilesystemTools } from './filesystem';
import { getTerminalTools } from './terminal';
import { getBrowserTools } from './browser';
import { getScreenshotTools } from './screenshot';
import { getClipboardTools } from './clipboard';
import { getSearchTools } from './search';
import { getGitTools } from './git';
import { getGitCommitGenTools } from './git-commit-gen';
import { getGitCleanupTools } from './git-cleanup';
import { getGitPRTools } from './git-pr';
import { getGitBisectTools } from './git-bisect';
import { getSystemCommandTools } from './system-commands';
import { getAppLauncherTools } from './app-launcher';
import { getMouseKeyboardTools } from './mouse-keyboard';
import { mediaControlTool } from './media-control';
import { getWindowManagerTools } from './window-manager';
import { getScreenVisionTools } from './screen-vision';
import { getPhoneTools } from './phone';
import { getCDPBrowserTools } from './browser-cdp';
import { getSpotifyTools } from './spotify';
import { getVSCodeTools } from './vscode';
import { getDiscordTools } from './discord';
import { getExplorerTools } from './explorer';
import { getBookmarkTools } from '../../integrations/bookmarks';
import { getFileSearchTools } from './file-search';
import { getTradingTools } from './trading';
import { getTradingTools as getAutonomousTradingTools } from '../../trading/tools';
import { getFinanceTools } from './finance';
import { getOCRTools } from './ocr';
import { getTemplateMatchingTools } from './template-matching';
import { getCalendarTools } from './calendar';
import { getEmailTools } from './email';
import { getCodeIntelligenceTools } from './code-intelligence';
import { getCodeAnalysisTools } from './code-analysis';
import { getCodeRefactorTools } from './code-refactor';
import { getDebugControllerTools } from './debug-controller';
import { getDocGeneratorTools } from './doc-generator';
import { getScaffoldingTools } from './scaffolding';
import { getMultiFileEditorTools } from './multi-file-editor';
import { vsCodeDeepTools } from './vscode-deep';
import { codeExplainTools } from './code-explain';
import { getPerplexityTools } from './perplexity-research';
import { getImageGenerationTools } from './image-generation';
import { getVisionAnalysisTools } from './vision-analysis';
import { getBrowserAgentTools } from '../browser-agent/tools';
import { getCareerTools as getCareerModuleTools } from '../../career/tools';
import { getBusinessTools } from './business';
import { getVMAgentTools } from '../../vm-agent/tools';

/**
 * Get all available agent tools across all categories.
 *
 * Returns a flat array of all registered tools that can be used by the agent.
 * Tools are aggregated from: filesystem, terminal, browser, screenshot,
 * clipboard, search, and git categories.
 *
 * @returns Array of all registered AgentTool instances
 *
 * @example
 * ```typescript
 * const tools = getAllTools();
 * console.log(`${tools.length} tools available`);
 *
 * // Convert to LLM tool definitions
 * const llmTools = tools.map(t => ({
 *   type: 'function',
 *   function: {
 *     name: t.name,
 *     description: t.description,
 *     parameters: t.parameters,
 *   }
 * }));
 * ```
 */
export function getAllTools(): AgentTool[] {
  return [
    ...getFilesystemTools(),
    ...getTerminalTools(),
    ...getBrowserTools(),
    ...getScreenshotTools(),
    ...getClipboardTools(),
    ...getSearchTools(),
    ...getGitTools(),
    ...getGitCommitGenTools(),
    ...getGitCleanupTools(),
    ...getGitPRTools(),
    ...getGitBisectTools(),
    ...getSystemCommandTools(),
    ...getAppLauncherTools(),
    ...getMouseKeyboardTools(),
    mediaControlTool,
    ...getWindowManagerTools(),
    ...getScreenVisionTools(),
    ...getBookmarkTools(),
    ...getFileSearchTools(),
    ...getPhoneTools(),
    ...getCDPBrowserTools(),
    ...getSpotifyTools(),
    ...getVSCodeTools(),
    ...getDiscordTools(),
    ...getExplorerTools(),
    ...getTradingTools(),
    ...getAutonomousTradingTools(),
    ...getFinanceTools(),
    ...getOCRTools(),
    ...getTemplateMatchingTools(),
    ...getCalendarTools(),
    ...getEmailTools(),
    ...getCodeIntelligenceTools(),
    ...getCodeAnalysisTools(),
    ...getCodeRefactorTools(),
    ...getDebugControllerTools(),
    ...getDocGeneratorTools(),
    ...getScaffoldingTools(),
    ...getMultiFileEditorTools(),
    // VS Code Deep Integration & Code Explanation tools
    ...Object.values(vsCodeDeepTools) as AgentTool[],
    ...Object.values(codeExplainTools) as AgentTool[],
    // Perplexity Research tools
    ...getPerplexityTools(),
    // Image Generation tools
    ...getImageGenerationTools(),
    // Vision Analysis tools (Fireworks AI)
    ...getVisionAnalysisTools(),
    // Browser Agent - Advanced AI browser automation (surpasses Claude for Chrome & Antigravity)
    ...getBrowserAgentTools().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      execute: t.handler,
    } as AgentTool)),
    // Career Module - Profile, skills gap, job search, CV optimization, interview prep
    ...getCareerModuleTools().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      execute: t.handler,
    } as AgentTool)),
    // Business Module - CRM, projects, time tracking, invoicing, expenses, pipeline
    ...getBusinessTools().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      execute: t.handler,
    } as AgentTool)),
    // VM Agent - Autonomous VM control with machine learning
    ...getVMAgentTools().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      execute: t.handler,
    } as AgentTool)),
  ];
}

/**
 * Tool categories for organization.
 *
 * Maps category names to arrays of tools in that category.
 * Categories:
 * - `filesystem` - File read/write/delete/list operations
 * - `terminal` - Command execution in shell
 * - `browser` - Playwright browser automation
 * - `screenshot` - Screen capture utilities
 * - `clipboard` - Clipboard read/write
 * - `search` - Web search and URL fetching
 * - `git` - Git version control operations
 * - `mouseKeyboard` - Mouse and keyboard automation
 * - `windowManager` - Window management operations
 * - `browserAgent` - AI-powered browser automation
 *
 * @example
 * ```typescript
 * // List all category names
 * const categories = Object.keys(toolCategories);
 *
 * // Get tools for a specific category
 * const gitTools = toolCategories.git;
 * ```
 */
export const toolCategories = {
  filesystem: getFilesystemTools(),
  terminal: getTerminalTools(),
  browser: getBrowserTools(),
  screenshot: getScreenshotTools(),
  clipboard: getClipboardTools(),
  search: getSearchTools(),
  git: [...getGitTools(), ...getGitCommitGenTools(), ...getGitPRTools(), ...getGitBisectTools()],
  system: getSystemCommandTools(),
  appLauncher: getAppLauncherTools(),
  mouseKeyboard: getMouseKeyboardTools(),
  windowManager: getWindowManagerTools(),
  screenVision: getScreenVisionTools(),
  bookmarks: getBookmarkTools(),
  fileSearch: getFileSearchTools(),
  phone: getPhoneTools(),
  browserCDP: getCDPBrowserTools(),
  spotify: getSpotifyTools(),
  vscode: getVSCodeTools(),
  discord: getDiscordTools(),
  explorer: getExplorerTools(),
  trading: getTradingTools(),
  autonomousTrading: getAutonomousTradingTools(),
  finance: getFinanceTools(),
  ocr: getOCRTools(),
  templateMatching: getTemplateMatchingTools(),
  calendar: getCalendarTools(),
  email: getEmailTools(),
  codeIntelligence: getCodeIntelligenceTools(),
  codeAnalysis: getCodeAnalysisTools(),
  codeRefactor: getCodeRefactorTools(),
  debugController: getDebugControllerTools(),
  docGenerator: getDocGeneratorTools(),
  scaffolding: getScaffoldingTools(),
  multiFileEditor: getMultiFileEditorTools(),
  vsCodeDeep: Object.values(vsCodeDeepTools) as AgentTool[],
  codeExplain: Object.values(codeExplainTools) as AgentTool[],
  browserAgent: getBrowserAgentTools().map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    execute: t.handler,
  } as AgentTool)),
  career: getCareerModuleTools().map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    execute: t.handler,
  } as AgentTool)),
  business: getBusinessTools().map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    execute: t.handler,
  } as AgentTool)),
  vmAgent: getVMAgentTools().map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    execute: t.handler,
  } as AgentTool)),
} as const;

/** Available tool category names */
export type ToolCategoryName = keyof typeof toolCategories;

/**
 * Get tools by category name.
 *
 * @param category - The category name to retrieve tools for
 * @returns Array of tools in the specified category, or empty array if not found
 *
 * @example
 * ```typescript
 * const fsTools = getToolsByCategory('filesystem');
 * console.log(`Filesystem has ${fsTools.length} tools`);
 *
 * // Check tool names in category
 * fsTools.forEach(t => console.log(`- ${t.name}: ${t.description}`));
 * ```
 */
export function getToolsByCategory(category: ToolCategoryName): AgentTool[] {
  return toolCategories[category] || [];
}

/**
 * Get tool by name across all categories.
 *
 * Searches all registered tools and returns the first match by name.
 * Tool names follow the pattern: `category_action` (e.g., `file_read`, `git_status`).
 *
 * @param name - The tool name to search for
 * @returns The matching tool, or undefined if not found
 *
 * @example
 * ```typescript
 * // Get a specific tool
 * const readTool = getToolByName('file_read');
 * if (readTool) {
 *   const result = await readTool.execute({ path: './readme.md' });
 * }
 *
 * // Check if a tool exists
 * if (getToolByName('custom_tool')) {
 *   // Tool is registered
 * }
 * ```
 */
export function getToolByName(name: string): AgentTool | undefined {
  return getAllTools().find((tool) => tool.name === name);
}

/**
 * Check if a tool exists by name.
 *
 * @param name - The tool name to check
 * @returns True if the tool exists, false otherwise
 *
 * @example
 * ```typescript
 * if (hasToolByName('git_commit')) {
 *   console.log('Git commit tool is available');
 * }
 * ```
 */
export function hasToolByName(name: string): boolean {
  return getToolByName(name) !== undefined;
}

/**
 * Get all tool names as an array.
 *
 * @returns Array of all tool names
 *
 * @example
 * ```typescript
 * const names = getToolNames();
 * // ['file_read', 'file_write', 'terminal_execute', ...]
 * ```
 */
export function getToolNames(): string[] {
  return getAllTools().map((tool) => tool.name);
}

/**
 * Get category names as an array.
 *
 * @returns Array of available category names
 */
export function getCategoryNames(): ToolCategoryName[] {
  return Object.keys(toolCategories) as ToolCategoryName[];
}

export default {
  getAllTools,
  getToolsByCategory,
  getToolByName,
  hasToolByName,
  getToolNames,
  getCategoryNames,
  toolCategories,
};
