/**
 * @fileoverview Canvas/A2UI System - Agent-driven visual workspace
 * @module canvas
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Provides a visual workspace that the agent can render content to.
 * Supports HTML rendering, interactive components, and the A2UI protocol
 * for rich agent-to-user interfaces.
 *
 * The Canvas system allows Atlas to:
 * - Render rich HTML content for display
 * - Create interactive forms and controls
 * - Display data visualizations
 * - Present multimedia content
 * - Build mini-applications on the fly
 *
 * @example
 * ```typescript
 * const canvas = getCanvas();
 * await canvas.render({
 *   type: 'html',
 *   content: '<h1>Hello World</h1><p>This is rendered by Atlas.</p>',
 * });
 * ```
 */

import { EventEmitter } from 'events';
import { BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('Canvas');

// =============================================================================
// Types
// =============================================================================

/**
 * Canvas content types
 */
export type CanvasContentType =
  | 'html'
  | 'markdown'
  | 'json'
  | 'image'
  | 'chart'
  | 'form'
  | 'table'
  | 'code'
  | 'iframe';

/**
 * Base canvas content
 */
export interface CanvasContent {
  /** Unique content ID */
  id?: string;
  /** Content type */
  type: CanvasContentType;
  /** Optional title */
  title?: string;
  /** Content data (varies by type) */
  content: string | Record<string, unknown>;
  /** Styling options */
  style?: CanvasStyle;
  /** Interactive options */
  interactive?: boolean;
  /** Callback ID for interactive content */
  callbackId?: string;
}

/**
 * Canvas styling options
 */
export interface CanvasStyle {
  /** Width (CSS value) */
  width?: string;
  /** Height (CSS value) */
  height?: string;
  /** Background color */
  backgroundColor?: string;
  /** Text color */
  color?: string;
  /** Font family */
  fontFamily?: string;
  /** Font size */
  fontSize?: string;
  /** Padding */
  padding?: string;
  /** Border radius */
  borderRadius?: string;
  /** Custom CSS */
  customCss?: string;
}

/**
 * Form field definition
 */
export interface FormField {
  /** Field name (used in result) */
  name: string;
  /** Field label */
  label: string;
  /** Field type */
  type: 'text' | 'number' | 'email' | 'password' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'date' | 'file';
  /** Placeholder text */
  placeholder?: string;
  /** Default value */
  defaultValue?: string | number | boolean;
  /** Required field */
  required?: boolean;
  /** Options for select/radio */
  options?: { value: string; label: string }[];
  /** Validation pattern */
  pattern?: string;
  /** Min value (for number) */
  min?: number;
  /** Max value (for number) */
  max?: number;
}

/**
 * Form content definition
 */
export interface FormContent {
  /** Form fields */
  fields: FormField[];
  /** Submit button text */
  submitText?: string;
  /** Cancel button text */
  cancelText?: string;
  /** Form description */
  description?: string;
}

/**
 * Table content definition
 */
export interface TableContent {
  /** Column headers */
  headers: string[];
  /** Row data */
  rows: (string | number | boolean)[][];
  /** Enable sorting */
  sortable?: boolean;
  /** Enable filtering */
  filterable?: boolean;
  /** Pagination */
  pageSize?: number;
}

/**
 * Chart content definition
 */
export interface ChartContent {
  /** Chart type */
  chartType: 'bar' | 'line' | 'pie' | 'doughnut' | 'scatter' | 'area';
  /** Chart data */
  data: {
    labels: string[];
    datasets: {
      label: string;
      data: number[];
      backgroundColor?: string | string[];
      borderColor?: string | string[];
    }[];
  };
  /** Chart options */
  options?: Record<string, unknown>;
}

/**
 * Canvas snapshot
 */
export interface CanvasSnapshot {
  /** Screenshot as base64 */
  image: string;
  /** HTML content */
  html: string;
  /** Visible text */
  text: string;
  /** Timestamp */
  timestamp: number;
}

/**
 * Canvas configuration
 */
export interface CanvasConfig {
  /** Window width */
  width?: number;
  /** Window height */
  height?: number;
  /** Show window on render */
  showOnRender?: boolean;
  /** Allow external navigation */
  allowNavigation?: boolean;
  /** Enable DevTools */
  devTools?: boolean;
}

/**
 * Canvas events
 */
export interface CanvasEvents {
  'render': (content: CanvasContent) => void;
  'clear': () => void;
  'interaction': (data: { callbackId: string; action: string; data: unknown }) => void;
  'form-submit': (data: { callbackId: string; values: Record<string, unknown> }) => void;
  'error': (error: Error) => void;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CONFIG: Required<CanvasConfig> = {
  width: 800,
  height: 600,
  showOnRender: true,
  allowNavigation: false,
  devTools: false,
};

// Base HTML template for canvas
const CANVAS_HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data:; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com;">
  <title>Atlas Canvas</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0f;
      color: #e0e0e0;
      padding: 20px;
      min-height: 100vh;
    }
    #canvas-root {
      max-width: 100%;
      margin: 0 auto;
    }
    .canvas-content {
      background: #1a1a24;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 16px;
      border: 1px solid #2a2a3a;
    }
    .canvas-title {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 16px;
      color: #fff;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #2a2a3a;
    }
    th {
      background: #0a0a0f;
      font-weight: 600;
      color: #00d9ff;
    }
    tr:hover {
      background: #252535;
    }
    input, textarea, select {
      width: 100%;
      padding: 10px 14px;
      background: #0a0a0f;
      border: 1px solid #2a2a3a;
      border-radius: 8px;
      color: #e0e0e0;
      font-size: 14px;
      margin-top: 6px;
    }
    input:focus, textarea:focus, select:focus {
      outline: none;
      border-color: #00d9ff;
    }
    label {
      display: block;
      margin-bottom: 16px;
      font-weight: 500;
    }
    button {
      padding: 10px 20px;
      background: linear-gradient(135deg, #00d9ff, #00ff88);
      border: none;
      border-radius: 8px;
      color: #000;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 20px rgba(0, 217, 255, 0.3);
    }
    button.secondary {
      background: #2a2a3a;
      color: #e0e0e0;
    }
    pre, code {
      background: #0a0a0f;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      font-family: 'Fira Code', 'Consolas', monospace;
      font-size: 13px;
    }
    img {
      max-width: 100%;
      border-radius: 8px;
    }
    .form-actions {
      display: flex;
      gap: 12px;
      margin-top: 24px;
    }
    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .checkbox-label input {
      width: auto;
      margin: 0;
    }
  </style>
</head>
<body>
  <div id="canvas-root"></div>
  <script>
    const { ipcRenderer } = require('electron');
    
    // Handle form submissions
    window.submitForm = function(callbackId) {
      const form = document.querySelector('form');
      const formData = new FormData(form);
      const values = Object.fromEntries(formData.entries());
      ipcRenderer.send('canvas:form-submit', { callbackId, values });
    };
    
    // Handle button clicks
    window.handleAction = function(callbackId, action, data) {
      ipcRenderer.send('canvas:interaction', { callbackId, action, data });
    };
    
    // Listen for content updates
    ipcRenderer.on('canvas:render', (event, content) => {
      const root = document.getElementById('canvas-root');
      root.innerHTML = content;
    });
    
    // Listen for clear
    ipcRenderer.on('canvas:clear', () => {
      document.getElementById('canvas-root').innerHTML = '';
    });
  </script>
</body>
</html>
`;

// =============================================================================
// Canvas Controller
// =============================================================================

/**
 * Controls the visual canvas workspace.
 *
 * Provides a rendering surface for agent-generated content including
 * HTML, forms, tables, charts, and other visual elements.
 *
 * @class Canvas
 * @extends EventEmitter
 *
 * @example
 * ```typescript
 * const canvas = new Canvas({ width: 1024, height: 768 });
 * await canvas.show();
 *
 * // Render HTML content
 * await canvas.render({
 *   type: 'html',
 *   title: 'Welcome',
 *   content: '<p>Hello from Atlas!</p>',
 * });
 *
 * // Render a form
 * const result = await canvas.renderForm({
 *   fields: [
 *     { name: 'email', label: 'Email', type: 'email', required: true },
 *     { name: 'message', label: 'Message', type: 'textarea' },
 *   ],
 *   submitText: 'Send',
 * });
 * console.log('Form submitted:', result);
 * ```
 */
export class Canvas extends EventEmitter {
  private _config: Required<CanvasConfig>;
  private _window: BrowserWindow | null = null;
  private _isVisible: boolean = false;
  private _pendingCallbacks: Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private _callbackCounter: number = 0;

  constructor(config: CanvasConfig = {}) {
    super();
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._setupIPC();
  }

  /**
   * Whether the canvas window is visible
   */
  get isVisible(): boolean {
    return this._isVisible;
  }

  /**
   * Show the canvas window.
   */
  async show(): Promise<void> {
    if (this._window) {
      this._window.show();
      this._isVisible = true;
      return;
    }

    logger.info('Creating canvas window', {
      width: this._config.width,
      height: this._config.height,
    });

    this._window = new BrowserWindow({
      width: this._config.width,
      height: this._config.height,
      title: 'Atlas Canvas',
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        devTools: this._config.devTools,
      },
    });

    // Load the canvas HTML
    await this._window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(CANVAS_HTML_TEMPLATE)}`);

    this._window.on('closed', () => {
      this._window = null;
      this._isVisible = false;
    });

    this._window.show();
    this._isVisible = true;

    if (this._config.devTools) {
      this._window.webContents.openDevTools();
    }
  }

  /**
   * Hide the canvas window.
   */
  hide(): void {
    if (this._window) {
      this._window.hide();
      this._isVisible = false;
    }
  }

  /**
   * Close the canvas window.
   */
  close(): void {
    if (this._window) {
      this._window.close();
      this._window = null;
      this._isVisible = false;
    }
  }

  /**
   * Render content to the canvas.
   *
   * @param {CanvasContent} content - The content to render
   */
  async render(content: CanvasContent): Promise<void> {
    if (!this._window) {
      if (this._config.showOnRender) {
        await this.show();
      } else {
        throw new Error('Canvas window not created. Call show() first.');
      }
    }

    const html = this._contentToHtml(content);
    this._window!.webContents.send('canvas:render', html);
    this.emit('render', content);

    logger.debug('Rendered content to canvas', { type: content.type });
  }

  /**
   * Render a form and wait for submission.
   *
   * @param {FormContent} formContent - The form definition
   * @param {string} title - Optional form title
   * @returns {Promise<Record<string, unknown>>} The submitted form values
   */
  async renderForm(formContent: FormContent, title?: string): Promise<Record<string, unknown>> {
    const callbackId = this._generateCallbackId();

    const content: CanvasContent = {
      type: 'form',
      title,
      content: formContent as unknown as Record<string, unknown>,
      interactive: true,
      callbackId,
    };

    await this.render(content);

    return new Promise((resolve, reject) => {
      this._pendingCallbacks.set(callbackId, { 
        resolve: resolve as (value: unknown) => void, 
        reject 
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this._pendingCallbacks.has(callbackId)) {
          this._pendingCallbacks.delete(callbackId);
          reject(new Error('Form submission timed out'));
        }
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Render a table.
   *
   * @param {TableContent} tableContent - The table definition
   * @param {string} title - Optional table title
   */
  async renderTable(tableContent: TableContent, title?: string): Promise<void> {
    const content: CanvasContent = {
      type: 'table',
      title,
      content: tableContent as unknown as Record<string, unknown>,
    };

    await this.render(content);
  }

  /**
   * Render a chart.
   *
   * @param {ChartContent} chartContent - The chart definition
   * @param {string} title - Optional chart title
   */
  async renderChart(chartContent: ChartContent, title?: string): Promise<void> {
    const content: CanvasContent = {
      type: 'chart',
      title,
      content: chartContent as unknown as Record<string, unknown>,
    };

    await this.render(content);
  }

  /**
   * Render markdown content.
   *
   * @param {string} markdown - The markdown to render
   * @param {string} title - Optional title
   */
  async renderMarkdown(markdown: string, title?: string): Promise<void> {
    const content: CanvasContent = {
      type: 'markdown',
      title,
      content: markdown,
    };

    await this.render(content);
  }

  /**
   * Render code with syntax highlighting.
   *
   * @param {string} code - The code to render
   * @param {string} language - Programming language for highlighting
   * @param {string} title - Optional title
   */
  async renderCode(code: string, language: string = 'javascript', title?: string): Promise<void> {
    const content: CanvasContent = {
      type: 'code',
      title,
      content: { code, language },
    };

    await this.render(content);
  }

  /**
   * Render an image.
   *
   * @param {string} src - Image source (URL or base64 data URI)
   * @param {string} alt - Alt text
   * @param {string} title - Optional title
   */
  async renderImage(src: string, alt: string = 'Image', title?: string): Promise<void> {
    const content: CanvasContent = {
      type: 'image',
      title,
      content: { src, alt },
    };

    await this.render(content);
  }

  /**
   * Clear the canvas.
   */
  clear(): void {
    if (this._window) {
      this._window.webContents.send('canvas:clear');
      this.emit('clear');
    }
  }

  /**
   * Take a snapshot of the canvas.
   *
   * @returns {Promise<CanvasSnapshot>} The canvas snapshot
   */
  async snapshot(): Promise<CanvasSnapshot> {
    if (!this._window) {
      throw new Error('Canvas window not created');
    }

    const image = await this._window.webContents.capturePage();
    const html = await this._window.webContents.executeJavaScript(
      'document.getElementById("canvas-root").innerHTML'
    );
    const text = await this._window.webContents.executeJavaScript(
      'document.getElementById("canvas-root").innerText'
    );

    return {
      image: image.toDataURL(),
      html,
      text,
      timestamp: Date.now(),
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Set up IPC handlers for canvas interactions.
   */
  private _setupIPC(): void {
    ipcMain.on('canvas:form-submit', (_, data) => {
      const { callbackId, values } = data;

      const callback = this._pendingCallbacks.get(callbackId);
      if (callback) {
        this._pendingCallbacks.delete(callbackId);
        callback.resolve(values);
      }

      this.emit('form-submit', data);
    });

    ipcMain.on('canvas:interaction', (_, data) => {
      this.emit('interaction', data);
    });
  }

  /**
   * Generate a unique callback ID.
   */
  private _generateCallbackId(): string {
    return `cb-${++this._callbackCounter}-${Date.now()}`;
  }

  /**
   * Convert canvas content to HTML.
   */
  private _contentToHtml(content: CanvasContent): string {
    let html = '<div class="canvas-content"';

    // Apply custom styles
    if (content.style) {
      const styles = Object.entries(content.style)
        .filter(([key]) => key !== 'customCss')
        .map(([key, value]) => `${this._camelToKebab(key)}: ${value}`)
        .join('; ');
      if (styles) {
        html += ` style="${styles}"`;
      }
    }

    html += '>';

    // Add title if present
    if (content.title) {
      html += `<h2 class="canvas-title">${this._escapeHtml(content.title)}</h2>`;
    }

    // Render content based on type
    switch (content.type) {
      case 'html':
        // Direct HTML (sanitized in production)
        html += content.content as string;
        break;

      case 'markdown':
        // Basic markdown rendering (would use marked.js in production)
        html += this._renderMarkdown(content.content as string);
        break;

      case 'code':
        const codeContent = content.content as { code: string; language: string };
        html += `<pre><code class="language-${codeContent.language}">${this._escapeHtml(codeContent.code)}</code></pre>`;
        break;

      case 'image':
        const imageContent = content.content as { src: string; alt: string };
        html += `<img src="${this._escapeHtml(imageContent.src)}" alt="${this._escapeHtml(imageContent.alt)}">`;
        break;

      case 'table':
        html += this._renderTable(content.content as unknown as TableContent);
        break;

      case 'form':
        html += this._renderForm(
          content.content as unknown as FormContent,
          content.callbackId || ''
        );
        break;

      case 'json':
        html += `<pre><code>${JSON.stringify(content.content, null, 2)}</code></pre>`;
        break;

      case 'iframe':
        const iframeSrc = content.content as string;
        html += `<iframe src="${this._escapeHtml(iframeSrc)}" style="width: 100%; height: 400px; border: none; border-radius: 8px;"></iframe>`;
        break;

      default:
        html += `<p>${this._escapeHtml(String(content.content))}</p>`;
    }

    html += '</div>';

    // Add custom CSS if present
    if (content.style?.customCss) {
      html = `<style>${content.style.customCss}</style>` + html;
    }

    return html;
  }

  /**
   * Render a form to HTML.
   */
  private _renderForm(form: FormContent, callbackId: string): string {
    let html = '<form onsubmit="event.preventDefault(); submitForm(\'' + callbackId + '\');">';

    if (form.description) {
      html += `<p style="margin-bottom: 20px; color: #888;">${this._escapeHtml(form.description)}</p>`;
    }

    for (const field of form.fields) {
      html += '<label>';
      html += `<span>${this._escapeHtml(field.label)}${field.required ? ' *' : ''}</span>`;

      switch (field.type) {
        case 'textarea':
          html += `<textarea name="${field.name}" placeholder="${field.placeholder || ''}" ${field.required ? 'required' : ''}>${field.defaultValue || ''}</textarea>`;
          break;

        case 'select':
          html += `<select name="${field.name}" ${field.required ? 'required' : ''}>`;
          for (const opt of field.options || []) {
            html += `<option value="${opt.value}" ${opt.value === field.defaultValue ? 'selected' : ''}>${this._escapeHtml(opt.label)}</option>`;
          }
          html += '</select>';
          break;

        case 'checkbox':
          html = html.replace('<label>', '<label class="checkbox-label">');
          html += `<input type="checkbox" name="${field.name}" ${field.defaultValue ? 'checked' : ''}>`;
          break;

        case 'radio':
          html += '<div>';
          for (const opt of field.options || []) {
            html += `<label class="checkbox-label"><input type="radio" name="${field.name}" value="${opt.value}" ${opt.value === field.defaultValue ? 'checked' : ''}> ${this._escapeHtml(opt.label)}</label>`;
          }
          html += '</div>';
          break;

        default:
          const attrs = [
            `type="${field.type}"`,
            `name="${field.name}"`,
            field.placeholder ? `placeholder="${field.placeholder}"` : '',
            field.defaultValue !== undefined ? `value="${field.defaultValue}"` : '',
            field.required ? 'required' : '',
            field.pattern ? `pattern="${field.pattern}"` : '',
            field.min !== undefined ? `min="${field.min}"` : '',
            field.max !== undefined ? `max="${field.max}"` : '',
          ].filter(Boolean).join(' ');

          html += `<input ${attrs}>`;
      }

      html += '</label>';
    }

    html += '<div class="form-actions">';
    html += `<button type="submit">${this._escapeHtml(form.submitText || 'Submit')}</button>`;
    if (form.cancelText) {
      html += `<button type="button" class="secondary" onclick="handleAction('${callbackId}', 'cancel', {})">${this._escapeHtml(form.cancelText)}</button>`;
    }
    html += '</div>';

    html += '</form>';
    return html;
  }

  /**
   * Render a table to HTML.
   */
  private _renderTable(table: TableContent): string {
    let html = '<table>';

    // Headers
    html += '<thead><tr>';
    for (const header of table.headers) {
      html += `<th>${this._escapeHtml(header)}</th>`;
    }
    html += '</tr></thead>';

    // Body
    html += '<tbody>';
    for (const row of table.rows) {
      html += '<tr>';
      for (const cell of row) {
        html += `<td>${this._escapeHtml(String(cell))}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody>';

    html += '</table>';
    return html;
  }

  /**
   * Basic markdown rendering (simplified).
   */
  private _renderMarkdown(markdown: string): string {
    // This is a simplified markdown renderer
    // In production, use a proper library like marked.js
    const html = markdown
      // Code blocks
      .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Headers
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // Line breaks
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');

    return `<p>${html}</p>`;
  }

  /**
   * Escape HTML special characters.
   */
  private _escapeHtml(text: string): string {
    const escapeMap: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (char) => escapeMap[char]);
  }

  /**
   * Convert camelCase to kebab-case.
   */
  private _camelToKebab(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let canvasInstance: Canvas | null = null;

/**
 * Get the shared canvas instance.
 *
 * @param {CanvasConfig} config - Optional configuration for new instance
 * @returns {Canvas} The canvas instance
 */
export function getCanvas(config?: CanvasConfig): Canvas {
  if (!canvasInstance) {
    canvasInstance = new Canvas(config);
  }
  return canvasInstance;
}

/**
 * Close and dispose of the canvas instance.
 */
export function closeCanvas(): void {
  if (canvasInstance) {
    canvasInstance.close();
    canvasInstance = null;
  }
}

export default Canvas;
