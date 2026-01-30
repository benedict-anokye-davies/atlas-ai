/**
 * @fileoverview Canvas Tools for Agent
 * @module agent/tools/canvas
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Provides agent tools for the visual canvas workspace. Allows the agent
 * to render rich content, forms, tables, charts, and interactive elements.
 *
 * @example
 * ```typescript
 * // Render HTML content
 * await canvasRenderTool.execute({
 *   type: 'html',
 *   content: '<h1>Hello!</h1>',
 * });
 *
 * // Show a form and get results
 * await canvasFormTool.execute({
 *   fields: [{ name: 'email', label: 'Email', type: 'email' }],
 * });
 * ```
 */

import type { AgentTool, ActionResult } from '../../../shared/types/agent';
import {
  getCanvas,
  closeCanvas,
  type CanvasContent,
  type FormContent,
  type TableContent,
  type ChartContent,
} from '../../canvas';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('CanvasTools');

// =============================================================================
// Canvas Render Tool
// =============================================================================

/**
 * Tool to render content to the canvas.
 */
export const canvasRenderTool: AgentTool = {
  name: 'canvas_render',
  description: `Render content to the visual canvas. The canvas is a visual workspace where you can display rich content to the user.

Supported content types:
- html: Raw HTML content
- markdown: Markdown text
- code: Code with syntax highlighting
- image: Display an image
- json: Pretty-printed JSON

Use this to show information visually, display results, or create rich presentations.`,

  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Content type to render',
        enum: ['html', 'markdown', 'code', 'image', 'json'],
      },
      content: {
        type: 'string',
        description: 'The content to render (HTML, markdown, code, image URL, or JSON string)',
      },
      title: {
        type: 'string',
        description: 'Optional title for the content',
      },
      language: {
        type: 'string',
        description: 'Programming language for code highlighting (when type is "code")',
      },
    },
    required: ['type', 'content'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const type = params.type as string;
      const content = params.content as string;
      const title = params.title as string | undefined;
      const language = params.language as string | undefined;

      if (!type || !content) {
        return {
          success: false,
          output: 'Both type and content are required',
          error: 'Missing parameters',
        };
      }

      logger.info('Rendering canvas content', { type, hasTitle: !!title });

      const canvas = getCanvas();

      if (type === 'code') {
        await canvas.renderCode(content, language || 'javascript', title);
      } else if (type === 'markdown') {
        await canvas.renderMarkdown(content, title);
      } else if (type === 'image') {
        await canvas.renderImage(content, title || 'Image', title);
      } else {
        // HTML or JSON
        const canvasContent: CanvasContent = {
          type: type as 'html' | 'json',
          content: type === 'json' ? JSON.parse(content) : content,
          title,
        };
        await canvas.render(canvasContent);
      }

      return {
        success: true,
        output: `✅ Rendered ${type} content to canvas${title ? `: "${title}"` : ''}.`,
        data: { type, hasTitle: !!title },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Canvas render failed', { error });

      return {
        success: false,
        output: `Failed to render: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Canvas Form Tool
// =============================================================================

/**
 * Tool to display a form and collect user input.
 */
export const canvasFormTool: AgentTool = {
  name: 'canvas_form',
  description: `Display a form on the canvas and wait for the user to submit it. Returns the submitted values.

Use this when you need to collect structured information from the user, such as:
- Configuration settings
- Personal information
- Preferences
- Confirmation dialogs

Field types: text, number, email, password, textarea, select, checkbox, radio, date`,

  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Form title',
      },
      description: {
        type: 'string',
        description: 'Form description/instructions',
      },
      fields: {
        type: 'array',
        description: 'Form fields',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Field name (used in result)' },
            label: { type: 'string', description: 'Field label' },
            type: {
              type: 'string',
              description: 'Field type',
              enum: ['text', 'number', 'email', 'password', 'textarea', 'select', 'checkbox', 'radio', 'date'],
            },
            placeholder: { type: 'string', description: 'Placeholder text' },
            required: { type: 'boolean', description: 'Is field required?' },
            defaultValue: { type: 'string', description: 'Default value' },
            options: {
              type: 'array',
              description: 'Options for select/radio fields',
              items: {
                type: 'object',
                properties: {
                  value: { type: 'string' },
                  label: { type: 'string' },
                },
              },
            },
          },
        },
      },
      submitText: {
        type: 'string',
        description: 'Submit button text',
        default: 'Submit',
      },
    },
    required: ['fields'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const fields = params.fields as FormContent['fields'];
      const title = params.title as string | undefined;
      const description = params.description as string | undefined;
      const submitText = (params.submitText as string) || 'Submit';

      if (!fields || !Array.isArray(fields) || fields.length === 0) {
        return {
          success: false,
          output: 'At least one field is required',
          error: 'No fields provided',
        };
      }

      logger.info('Displaying canvas form', { fieldCount: fields.length, title });

      const canvas = getCanvas();
      const formContent: FormContent = {
        fields,
        description,
        submitText,
      };

      const result = await canvas.renderForm(formContent, title);

      logger.info('Form submitted', { fieldCount: Object.keys(result).length });

      return {
        success: true,
        output: `✅ Form submitted with ${Object.keys(result).length} values:\n${JSON.stringify(result, null, 2)}`,
        data: { values: result },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Canvas form failed', { error });

      return {
        success: false,
        output: `Form failed: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Canvas Table Tool
// =============================================================================

/**
 * Tool to display a table on the canvas.
 */
export const canvasTableTool: AgentTool = {
  name: 'canvas_table',
  description: `Display a data table on the canvas. Use this to present structured data in a readable format.`,

  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Table title',
      },
      headers: {
        type: 'array',
        description: 'Column headers',
        items: { type: 'string' },
      },
      rows: {
        type: 'array',
        description: 'Table rows (array of arrays)',
        items: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
    required: ['headers', 'rows'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const headers = params.headers as string[];
      const rows = params.rows as (string | number | boolean)[][];
      const title = params.title as string | undefined;

      if (!headers || !rows) {
        return {
          success: false,
          output: 'Headers and rows are required',
          error: 'Missing parameters',
        };
      }

      logger.info('Displaying canvas table', { columns: headers.length, rows: rows.length });

      const canvas = getCanvas();
      const tableContent: TableContent = { headers, rows };
      await canvas.renderTable(tableContent, title);

      return {
        success: true,
        output: `✅ Displayed table with ${headers.length} columns and ${rows.length} rows.`,
        data: { columns: headers.length, rows: rows.length },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Canvas table failed', { error });

      return {
        success: false,
        output: `Table failed: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Canvas Chart Tool
// =============================================================================

/**
 * Tool to display a chart on the canvas.
 */
export const canvasChartTool: AgentTool = {
  name: 'canvas_chart',
  description: `Display a chart on the canvas. Supports bar, line, pie, doughnut, scatter, and area charts.

Use this to visualize data trends, comparisons, or distributions.`,

  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Chart title',
      },
      chartType: {
        type: 'string',
        description: 'Type of chart',
        enum: ['bar', 'line', 'pie', 'doughnut', 'scatter', 'area'],
      },
      labels: {
        type: 'array',
        description: 'Data labels (X-axis or slice labels)',
        items: { type: 'string' },
      },
      datasets: {
        type: 'array',
        description: 'Data series',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Series label' },
            data: {
              type: 'array',
              description: 'Data values',
              items: { type: 'number' },
            },
          },
        },
      },
    },
    required: ['chartType', 'labels', 'datasets'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const chartType = params.chartType as ChartContent['chartType'];
      const labels = params.labels as string[];
      const datasets = params.datasets as { label: string; data: number[] }[];
      const title = params.title as string | undefined;

      if (!chartType || !labels || !datasets) {
        return {
          success: false,
          output: 'chartType, labels, and datasets are required',
          error: 'Missing parameters',
        };
      }

      logger.info('Displaying canvas chart', { chartType, labelCount: labels.length });

      const canvas = getCanvas();
      const chartContent: ChartContent = {
        chartType,
        data: { labels, datasets },
      };
      await canvas.renderChart(chartContent, title);

      return {
        success: true,
        output: `✅ Displayed ${chartType} chart with ${labels.length} data points.`,
        data: { chartType, labelCount: labels.length, seriesCount: datasets.length },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Canvas chart failed', { error });

      return {
        success: false,
        output: `Chart failed: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Canvas Snapshot Tool
// =============================================================================

/**
 * Tool to take a snapshot of the canvas.
 */
export const canvasSnapshotTool: AgentTool = {
  name: 'canvas_snapshot',
  description: `Take a snapshot of the current canvas. Returns a screenshot and text content.`,

  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },

  async execute(): Promise<ActionResult> {
    try {
      logger.info('Taking canvas snapshot');

      const canvas = getCanvas();

      if (!canvas.isVisible) {
        return {
          success: false,
          output: 'Canvas is not visible. Render content first.',
          error: 'Canvas not visible',
        };
      }

      const snapshot = await canvas.snapshot();

      return {
        success: true,
        output: `✅ Canvas snapshot taken.\n\nVisible text:\n${snapshot.text.slice(0, 500)}${snapshot.text.length > 500 ? '...' : ''}`,
        data: {
          hasImage: !!snapshot.image,
          textLength: snapshot.text.length,
          timestamp: snapshot.timestamp,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Canvas snapshot failed', { error });

      return {
        success: false,
        output: `Snapshot failed: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Canvas Clear Tool
// =============================================================================

/**
 * Tool to clear the canvas.
 */
export const canvasClearTool: AgentTool = {
  name: 'canvas_clear',
  description: `Clear all content from the canvas.`,

  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },

  async execute(): Promise<ActionResult> {
    try {
      logger.info('Clearing canvas');

      const canvas = getCanvas();
      canvas.clear();

      return {
        success: true,
        output: '✅ Canvas cleared.',
        data: {},
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Canvas clear failed', { error });

      return {
        success: false,
        output: `Clear failed: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Canvas Close Tool
// =============================================================================

/**
 * Tool to close the canvas window.
 */
export const canvasCloseTool: AgentTool = {
  name: 'canvas_close',
  description: `Close the canvas window.`,

  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },

  async execute(): Promise<ActionResult> {
    try {
      logger.info('Closing canvas');

      closeCanvas();

      return {
        success: true,
        output: '✅ Canvas closed.',
        data: {},
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Canvas close failed', { error });

      return {
        success: false,
        output: `Close failed: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Export All Canvas Tools
// =============================================================================

export const canvasTools: AgentTool[] = [
  canvasRenderTool,
  canvasFormTool,
  canvasTableTool,
  canvasChartTool,
  canvasSnapshotTool,
  canvasClearTool,
  canvasCloseTool,
];

export default canvasTools;
