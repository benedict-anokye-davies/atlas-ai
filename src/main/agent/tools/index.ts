/**
 * Nova Desktop - Agent Tools Index
 * Exports all agent tools
 */

// Re-export all tools from each category
export * from './filesystem';
export * from './terminal';
export * from './browser';
export * from './screenshot';
export * from './clipboard';
// Note: websearch.ts has duplicate exports (webSearchTool, fetchUrlTool) with search.ts
// search.ts uses fetch() which is cleaner, so we use that instead
export * from './search';

import { AgentTool } from '../../../shared/types/agent';
import { getFilesystemTools } from './filesystem';
import { getTerminalTools } from './terminal';
import { getBrowserTools } from './browser';
import { getScreenshotTools } from './screenshot';
import { getClipboardTools } from './clipboard';
import { getSearchTools } from './search';

/**
 * Get all available agent tools
 */
export function getAllTools(): AgentTool[] {
  return [
    ...getFilesystemTools(),
    ...getTerminalTools(),
    ...getBrowserTools(),
    ...getScreenshotTools(),
    ...getClipboardTools(),
    ...getSearchTools(),
  ];
}

/**
 * Tool categories for organization
 */
export const toolCategories = {
  filesystem: getFilesystemTools(),
  terminal: getTerminalTools(),
  browser: getBrowserTools(),
  screenshot: getScreenshotTools(),
  clipboard: getClipboardTools(),
  search: getSearchTools(),
} as const;

/**
 * Get tools by category name
 */
export function getToolsByCategory(category: keyof typeof toolCategories): AgentTool[] {
  return toolCategories[category] || [];
}

/**
 * Get tool by name across all categories
 */
export function getToolByName(name: string): AgentTool | undefined {
  return getAllTools().find((tool) => tool.name === name);
}

export default {
  getAllTools,
  getToolsByCategory,
  getToolByName,
  toolCategories,
};
