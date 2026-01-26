/**
 * Atlas Desktop - Figma Integration
 * 
 * Connects to Figma to:
 * - Convert designs to React/HTML/CSS code
 * - Sync design tokens and styles
 * - Extract component structures
 * - Monitor design changes
 * - Generate responsive layouts
 * 
 * @module integrations/figma
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createModuleLogger } from '../utils/logger';
import { getStore } from '../store';

const logger = createModuleLogger('FigmaIntegration');

// ============================================================================
// Types
// ============================================================================

export interface FigmaConfig {
  accessToken: string;
  teamId?: string;
  projectId?: string;
  outputDir: string;
  framework: 'react' | 'vue' | 'html' | 'svelte';
  styling: 'css' | 'scss' | 'tailwind' | 'styled-components' | 'emotion';
  typescript: boolean;
  generateStories: boolean; // Storybook
}

export interface FigmaFile {
  key: string;
  name: string;
  lastModified: string;
  thumbnailUrl: string;
}

export interface FigmaComponent {
  id: string;
  name: string;
  type: string;
  description?: string;
  properties: ComponentProperty[];
  styles: FigmaStyle[];
  children: FigmaComponent[];
  absoluteBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ComponentProperty {
  name: string;
  type: 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP' | 'VARIANT';
  defaultValue?: any;
  variantOptions?: string[];
}

export interface FigmaStyle {
  type: 'FILL' | 'STROKE' | 'EFFECT' | 'TEXT';
  name: string;
  value: any;
}

export interface DesignToken {
  name: string;
  type: 'color' | 'typography' | 'spacing' | 'shadow' | 'radius';
  value: any;
  figmaId: string;
}

export interface GeneratedCode {
  componentName: string;
  code: string;
  styles: string;
  types?: string;
  story?: string;
  filePath: string;
}

// ============================================================================
// Figma API Client
// ============================================================================

const FIGMA_API_BASE = 'https://api.figma.com/v1';

export class FigmaClient {
  private accessToken: string;
  
  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }
  
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${FIGMA_API_BASE}${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'X-Figma-Token': this.accessToken,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Figma API error: ${response.status} - ${error}`);
    }
    
    return response.json();
  }
  
  async getTeamProjects(teamId: string): Promise<any> {
    return this.request(`/teams/${teamId}/projects`);
  }
  
  async getProjectFiles(projectId: string): Promise<{ files: FigmaFile[] }> {
    return this.request(`/projects/${projectId}/files`);
  }
  
  async getFile(fileKey: string): Promise<any> {
    return this.request(`/files/${fileKey}`);
  }
  
  async getFileNodes(fileKey: string, nodeIds: string[]): Promise<any> {
    return this.request(`/files/${fileKey}/nodes?ids=${nodeIds.join(',')}`);
  }
  
  async getFileComponents(fileKey: string): Promise<any> {
    return this.request(`/files/${fileKey}/components`);
  }
  
  async getFileStyles(fileKey: string): Promise<any> {
    return this.request(`/files/${fileKey}/styles`);
  }
  
  async getImage(fileKey: string, nodeIds: string[], format: 'png' | 'jpg' | 'svg' = 'svg'): Promise<any> {
    return this.request(`/images/${fileKey}?ids=${nodeIds.join(',')}&format=${format}`);
  }
}

// ============================================================================
// Code Generator
// ============================================================================

export class FigmaCodeGenerator {
  private config: FigmaConfig;
  
  constructor(config: FigmaConfig) {
    this.config = config;
  }
  
  async generateComponent(component: FigmaComponent): Promise<GeneratedCode> {
    const componentName = this.sanitizeComponentName(component.name);
    
    let code: string;
    let styles: string;
    let types: string | undefined;
    let story: string | undefined;
    
    switch (this.config.framework) {
      case 'react':
        ({ code, styles, types } = this.generateReactComponent(component, componentName));
        break;
      case 'vue':
        ({ code, styles } = this.generateVueComponent(component, componentName));
        break;
      case 'html':
        ({ code, styles } = this.generateHtmlComponent(component, componentName));
        break;
      case 'svelte':
        ({ code, styles } = this.generateSvelteComponent(component, componentName));
        break;
      default:
        throw new Error(`Unsupported framework: ${this.config.framework}`);
    }
    
    if (this.config.generateStories) {
      story = this.generateStory(component, componentName);
    }
    
    const filePath = this.getFilePath(componentName);
    
    return { componentName, code, styles, types, story, filePath };
  }
  
  private sanitizeComponentName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9]/g, '')
      .replace(/^[a-z]/, c => c.toUpperCase());
  }
  
  private getFilePath(componentName: string): string {
    const ext = this.config.typescript ? 'tsx' : 'jsx';
    return path.join(this.config.outputDir, 'components', `${componentName}.${ext}`);
  }
  
  // ==========================================================================
  // React Generator
  // ==========================================================================
  
  private generateReactComponent(
    component: FigmaComponent,
    name: string
  ): { code: string; styles: string; types?: string } {
    const props = this.extractProps(component);
    const hasProps = props.length > 0;
    
    const propsType = hasProps ? `${name}Props` : '';
    const propsInterface = hasProps
      ? `interface ${name}Props {\n${props.map(p => `  ${p.name}${p.required ? '' : '?'}: ${p.type};`).join('\n')}\n}`
      : '';
    
    const cssClassName = this.toKebabCase(name);
    const styles = this.generateStyles(component, cssClassName);
    
    const tsx = this.config.typescript;
    
    let code = `import React from 'react';\n`;
    
    if (this.config.styling === 'styled-components') {
      code += `import styled from 'styled-components';\n`;
    } else if (this.config.styling === 'emotion') {
      code += `import { css } from '@emotion/react';\nimport styled from '@emotion/styled';\n`;
    } else {
      code += `import './${name}.${this.config.styling === 'scss' ? 'scss' : 'css'}';\n`;
    }
    
    code += `\n`;
    
    if (tsx && propsInterface) {
      code += `${propsInterface}\n\n`;
    }
    
    code += `export const ${name}${tsx && hasProps ? `: React.FC<${propsType}>` : ''} = (${hasProps ? `{ ${props.map(p => p.name).join(', ')} }` : ''}) => {\n`;
    code += `  return (\n`;
    code += `    <div className="${cssClassName}">\n`;
    code += this.generateJSXChildren(component.children, 3);
    code += `    </div>\n`;
    code += `  );\n`;
    code += `};\n\n`;
    code += `export default ${name};\n`;
    
    return {
      code,
      styles,
      types: tsx ? propsInterface : undefined,
    };
  }
  
  private generateJSXChildren(children: FigmaComponent[], indent: number): string {
    if (!children || children.length === 0) return '';
    
    const spaces = ' '.repeat(indent * 2);
    let jsx = '';
    
    for (const child of children) {
      const className = this.toKebabCase(child.name);
      const tag = this.getHtmlTag(child.type);
      
      if (child.children && child.children.length > 0) {
        jsx += `${spaces}<${tag} className="${className}">\n`;
        jsx += this.generateJSXChildren(child.children, indent + 1);
        jsx += `${spaces}</${tag}>\n`;
      } else {
        jsx += `${spaces}<${tag} className="${className}" />\n`;
      }
    }
    
    return jsx;
  }
  
  private getHtmlTag(figmaType: string): string {
    const tagMap: Record<string, string> = {
      'TEXT': 'span',
      'FRAME': 'div',
      'GROUP': 'div',
      'COMPONENT': 'div',
      'INSTANCE': 'div',
      'RECTANGLE': 'div',
      'ELLIPSE': 'div',
      'LINE': 'hr',
      'VECTOR': 'svg',
    };
    
    return tagMap[figmaType] || 'div';
  }
  
  // ==========================================================================
  // Vue Generator
  // ==========================================================================
  
  private generateVueComponent(
    component: FigmaComponent,
    name: string
  ): { code: string; styles: string } {
    const props = this.extractProps(component);
    const cssClassName = this.toKebabCase(name);
    const styles = this.generateStyles(component, cssClassName);
    
    let code = `<template>\n`;
    code += `  <div class="${cssClassName}">\n`;
    code += this.generateVueChildren(component.children, 2);
    code += `  </div>\n`;
    code += `</template>\n\n`;
    
    code += `<script${this.config.typescript ? ' lang="ts"' : ''} setup>\n`;
    if (props.length > 0) {
      code += `defineProps<{\n`;
      code += props.map(p => `  ${p.name}${p.required ? '' : '?'}: ${p.type};`).join('\n');
      code += `\n}>();\n`;
    }
    code += `</script>\n\n`;
    
    code += `<style${this.config.styling === 'scss' ? ' lang="scss"' : ''} scoped>\n`;
    code += styles;
    code += `</style>\n`;
    
    return { code, styles };
  }
  
  private generateVueChildren(children: FigmaComponent[], indent: number): string {
    if (!children || children.length === 0) return '';
    
    const spaces = ' '.repeat(indent * 2);
    let html = '';
    
    for (const child of children) {
      const className = this.toKebabCase(child.name);
      const tag = this.getHtmlTag(child.type);
      
      if (child.children && child.children.length > 0) {
        html += `${spaces}<${tag} class="${className}">\n`;
        html += this.generateVueChildren(child.children, indent + 1);
        html += `${spaces}</${tag}>\n`;
      } else {
        html += `${spaces}<${tag} class="${className}" />\n`;
      }
    }
    
    return html;
  }
  
  // ==========================================================================
  // HTML Generator
  // ==========================================================================
  
  private generateHtmlComponent(
    component: FigmaComponent,
    name: string
  ): { code: string; styles: string } {
    const cssClassName = this.toKebabCase(name);
    const styles = this.generateStyles(component, cssClassName);
    
    let code = `<!DOCTYPE html>\n`;
    code += `<html lang="en">\n`;
    code += `<head>\n`;
    code += `  <meta charset="UTF-8">\n`;
    code += `  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n`;
    code += `  <title>${name}</title>\n`;
    code += `  <link rel="stylesheet" href="${name}.css">\n`;
    code += `</head>\n`;
    code += `<body>\n`;
    code += `  <div class="${cssClassName}">\n`;
    code += this.generateHtmlChildren(component.children, 2);
    code += `  </div>\n`;
    code += `</body>\n`;
    code += `</html>\n`;
    
    return { code, styles };
  }
  
  private generateHtmlChildren(children: FigmaComponent[], indent: number): string {
    return this.generateVueChildren(children, indent); // Same structure
  }
  
  // ==========================================================================
  // Svelte Generator
  // ==========================================================================
  
  private generateSvelteComponent(
    component: FigmaComponent,
    name: string
  ): { code: string; styles: string } {
    const props = this.extractProps(component);
    const cssClassName = this.toKebabCase(name);
    const styles = this.generateStyles(component, cssClassName);
    
    let code = `<script${this.config.typescript ? ' lang="ts"' : ''}>\n`;
    if (props.length > 0) {
      props.forEach(p => {
        code += `  export let ${p.name}${this.config.typescript ? `: ${p.type}` : ''}${p.required ? '' : ` = ${p.defaultValue || 'undefined'}`};\n`;
      });
    }
    code += `</script>\n\n`;
    
    code += `<div class="${cssClassName}">\n`;
    code += this.generateVueChildren(component.children, 1);
    code += `</div>\n\n`;
    
    code += `<style${this.config.styling === 'scss' ? ' lang="scss"' : ''}>\n`;
    code += styles;
    code += `</style>\n`;
    
    return { code, styles };
  }
  
  // ==========================================================================
  // Styles Generator
  // ==========================================================================
  
  private generateStyles(component: FigmaComponent, className: string): string {
    if (this.config.styling === 'tailwind') {
      return this.generateTailwindClasses(component);
    }
    
    let css = '';
    
    // Main component styles
    css += `.${className} {\n`;
    css += this.stylesToCSS(component.styles, component.absoluteBounds);
    css += `}\n\n`;
    
    // Child styles
    css += this.generateChildStyles(component.children, className);
    
    return css;
  }
  
  private stylesToCSS(styles: FigmaStyle[], bounds: { width: number; height: number }): string {
    let css = '';
    
    css += `  display: flex;\n`;
    css += `  width: ${bounds.width}px;\n`;
    css += `  height: ${bounds.height}px;\n`;
    
    for (const style of styles) {
      switch (style.type) {
        case 'FILL':
          if (style.value.type === 'SOLID') {
            const { r, g, b, a = 1 } = style.value.color;
            css += `  background-color: rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a});\n`;
          }
          break;
        case 'STROKE':
          if (style.value.color) {
            const { r, g, b, a = 1 } = style.value.color;
            css += `  border: ${style.value.weight || 1}px solid rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a});\n`;
          }
          break;
        case 'EFFECT':
          if (style.value.type === 'DROP_SHADOW') {
            const { offset, radius, color } = style.value;
            css += `  box-shadow: ${offset?.x || 0}px ${offset?.y || 0}px ${radius || 0}px rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a});\n`;
          }
          break;
        case 'TEXT':
          css += `  font-family: "${style.value.fontFamily}", sans-serif;\n`;
          css += `  font-size: ${style.value.fontSize}px;\n`;
          css += `  font-weight: ${style.value.fontWeight};\n`;
          break;
      }
    }
    
    return css;
  }
  
  private generateChildStyles(children: FigmaComponent[], parentClass: string): string {
    if (!children || children.length === 0) return '';
    
    let css = '';
    
    for (const child of children) {
      const childClass = this.toKebabCase(child.name);
      css += `.${parentClass} .${childClass} {\n`;
      css += this.stylesToCSS(child.styles, child.absoluteBounds);
      css += `}\n\n`;
      
      if (child.children && child.children.length > 0) {
        css += this.generateChildStyles(child.children, childClass);
      }
    }
    
    return css;
  }
  
  private generateTailwindClasses(component: FigmaComponent): string {
    const classes: string[] = [];
    
    classes.push('flex');
    
    // Width/height
    const { width, height } = component.absoluteBounds;
    classes.push(`w-[${width}px]`);
    classes.push(`h-[${height}px]`);
    
    // Styles
    for (const style of component.styles) {
      if (style.type === 'FILL' && style.value.type === 'SOLID') {
        const { r, g, b } = style.value.color;
        classes.push(`bg-[rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})]`);
      }
    }
    
    return classes.join(' ');
  }
  
  // ==========================================================================
  // Storybook Generator
  // ==========================================================================
  
  private generateStory(component: FigmaComponent, name: string): string {
    const props = this.extractProps(component);
    
    let story = `import type { Meta, StoryObj } from '@storybook/react';\n`;
    story += `import { ${name} } from './${name}';\n\n`;
    
    story += `const meta: Meta<typeof ${name}> = {\n`;
    story += `  title: 'Components/${name}',\n`;
    story += `  component: ${name},\n`;
    story += `  tags: ['autodocs'],\n`;
    
    if (props.length > 0) {
      story += `  argTypes: {\n`;
      props.forEach(p => {
        story += `    ${p.name}: { control: '${p.control}' },\n`;
      });
      story += `  },\n`;
    }
    
    story += `};\n\n`;
    story += `export default meta;\n`;
    story += `type Story = StoryObj<typeof ${name}>;\n\n`;
    
    story += `export const Default: Story = {\n`;
    if (props.length > 0) {
      story += `  args: {\n`;
      props.forEach(p => {
        story += `    ${p.name}: ${JSON.stringify(p.defaultValue)},\n`;
      });
      story += `  },\n`;
    }
    story += `};\n`;
    
    return story;
  }
  
  // ==========================================================================
  // Utilities
  // ==========================================================================
  
  private extractProps(component: FigmaComponent): Array<{
    name: string;
    type: string;
    required: boolean;
    defaultValue?: any;
    control: string;
  }> {
    return component.properties.map(p => ({
      name: this.toCamelCase(p.name),
      type: p.type === 'BOOLEAN' ? 'boolean' : p.type === 'TEXT' ? 'string' : 'string',
      required: !p.defaultValue,
      defaultValue: p.defaultValue,
      control: p.type === 'BOOLEAN' ? 'boolean' : 'text',
    }));
  }
  
  private toKebabCase(str: string): string {
    return str
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .toLowerCase();
  }
  
  private toCamelCase(str: string): string {
    return str
      .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => 
        index === 0 ? word.toLowerCase() : word.toUpperCase()
      )
      .replace(/\s+/g, '');
  }
}

// ============================================================================
// Figma Integration Class
// ============================================================================

export class FigmaIntegration extends EventEmitter {
  private config: FigmaConfig;
  private client: FigmaClient | null = null;
  private generator: FigmaCodeGenerator | null = null;
  
  constructor(config: Partial<FigmaConfig> = {}) {
    super();
    
    this.config = {
      accessToken: config.accessToken || '',
      outputDir: config.outputDir || path.join(process.cwd(), 'src'),
      framework: config.framework || 'react',
      styling: config.styling || 'tailwind',
      typescript: config.typescript ?? true,
      generateStories: config.generateStories ?? true,
    };
  }
  
  async initialize(accessToken?: string): Promise<void> {
    if (accessToken) {
      this.config.accessToken = accessToken;
    }
    
    if (!this.config.accessToken) {
      const store = getStore();
      const apiKeys = store.get('apiKeys');
      this.config.accessToken = apiKeys?.figma || '';
    }
    
    if (!this.config.accessToken) {
      throw new Error('Figma access token required');
    }
    
    this.client = new FigmaClient(this.config.accessToken);
    this.generator = new FigmaCodeGenerator(this.config);
    
    logger.info('Figma Integration initialized');
    this.emit('initialized');
  }
  
  async importFile(fileKey: string): Promise<GeneratedCode[]> {
    if (!this.client || !this.generator) {
      throw new Error('Figma Integration not initialized');
    }
    
    logger.info('Importing Figma file', { fileKey });
    
    // Get file data
    const file = await this.client.getFile(fileKey);
    const components = await this.client.getFileComponents(fileKey);
    
    const generatedCode: GeneratedCode[] = [];
    
    // Process each component
    for (const meta of Object.values(components.meta?.components || {})) {
      const componentData = meta as any;
      
      const component: FigmaComponent = {
        id: componentData.node_id,
        name: componentData.name,
        type: 'COMPONENT',
        description: componentData.description,
        properties: [],
        styles: [],
        children: [],
        absoluteBounds: { x: 0, y: 0, width: 100, height: 100 },
      };
      
      const generated = await this.generator.generateComponent(component);
      generatedCode.push(generated);
      
      // Write files
      await this.writeGeneratedCode(generated);
    }
    
    this.emit('fileImported', { fileKey, components: generatedCode.length });
    logger.info('Figma file imported', { fileKey, components: generatedCode.length });
    
    return generatedCode;
  }
  
  async importComponent(fileKey: string, nodeId: string): Promise<GeneratedCode> {
    if (!this.client || !this.generator) {
      throw new Error('Figma Integration not initialized');
    }
    
    const nodes = await this.client.getFileNodes(fileKey, [nodeId]);
    const node = nodes.nodes[nodeId];
    
    if (!node) {
      throw new Error(`Component not found: ${nodeId}`);
    }
    
    const component = this.nodeToComponent(node.document);
    const generated = await this.generator.generateComponent(component);
    
    await this.writeGeneratedCode(generated);
    
    this.emit('componentImported', { fileKey, nodeId, name: generated.componentName });
    
    return generated;
  }
  
  async syncDesignTokens(fileKey: string): Promise<DesignToken[]> {
    if (!this.client) {
      throw new Error('Figma Integration not initialized');
    }
    
    const styles = await this.client.getFileStyles(fileKey);
    const tokens: DesignToken[] = [];
    
    for (const meta of Object.values(styles.meta?.styles || {})) {
      const style = meta as any;
      
      const token: DesignToken = {
        name: style.name,
        type: this.getTokenType(style.style_type),
        value: style.description, // Simplified - full impl would extract actual values
        figmaId: style.node_id,
      };
      
      tokens.push(token);
    }
    
    // Write tokens file
    const tokensPath = path.join(this.config.outputDir, 'design-tokens.json');
    await fs.writeFile(tokensPath, JSON.stringify(tokens, null, 2));
    
    this.emit('tokensSynced', { count: tokens.length });
    logger.info('Design tokens synced', { count: tokens.length });
    
    return tokens;
  }
  
  private nodeToComponent(node: any): FigmaComponent {
    return {
      id: node.id,
      name: node.name,
      type: node.type,
      description: node.description,
      properties: this.extractComponentProperties(node),
      styles: this.extractStyles(node),
      children: (node.children || []).map((c: any) => this.nodeToComponent(c)),
      absoluteBounds: node.absoluteBoundingBox || { x: 0, y: 0, width: 100, height: 100 },
    };
  }
  
  private extractComponentProperties(node: any): ComponentProperty[] {
    const props: ComponentProperty[] = [];
    
    if (node.componentPropertyDefinitions) {
      for (const [name, def] of Object.entries(node.componentPropertyDefinitions)) {
        const propDef = def as any;
        props.push({
          name,
          type: propDef.type,
          defaultValue: propDef.defaultValue,
          variantOptions: propDef.variantOptions,
        });
      }
    }
    
    return props;
  }
  
  private extractStyles(node: any): FigmaStyle[] {
    const styles: FigmaStyle[] = [];
    
    if (node.fills) {
      for (const fill of node.fills) {
        if (fill.visible !== false) {
          styles.push({ type: 'FILL', name: 'fill', value: fill });
        }
      }
    }
    
    if (node.strokes) {
      for (const stroke of node.strokes) {
        styles.push({ type: 'STROKE', name: 'stroke', value: { ...stroke, weight: node.strokeWeight } });
      }
    }
    
    if (node.effects) {
      for (const effect of node.effects) {
        if (effect.visible !== false) {
          styles.push({ type: 'EFFECT', name: effect.type, value: effect });
        }
      }
    }
    
    if (node.style) {
      styles.push({ type: 'TEXT', name: 'text', value: node.style });
    }
    
    return styles;
  }
  
  private getTokenType(styleType: string): DesignToken['type'] {
    const typeMap: Record<string, DesignToken['type']> = {
      'FILL': 'color',
      'TEXT': 'typography',
      'EFFECT': 'shadow',
      'GRID': 'spacing',
    };
    return typeMap[styleType] || 'color';
  }
  
  private async writeGeneratedCode(generated: GeneratedCode): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(generated.filePath);
    await fs.mkdir(dir, { recursive: true });
    
    // Write main component file
    await fs.writeFile(generated.filePath, generated.code);
    
    // Write styles file
    if (generated.styles && this.config.styling !== 'tailwind') {
      const ext = this.config.styling === 'scss' ? 'scss' : 'css';
      const stylesPath = generated.filePath.replace(/\.[jt]sx?$/, `.${ext}`);
      await fs.writeFile(stylesPath, generated.styles);
    }
    
    // Write story file
    if (generated.story) {
      const storyPath = generated.filePath.replace(/\.[jt]sx?$/, '.stories.tsx');
      await fs.writeFile(storyPath, generated.story);
    }
    
    logger.info('Generated code written', { path: generated.filePath });
  }
  
  setConfig(config: Partial<FigmaConfig>): void {
    this.config = { ...this.config, ...config };
    if (this.config.accessToken) {
      this.client = new FigmaClient(this.config.accessToken);
    }
    this.generator = new FigmaCodeGenerator(this.config);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: FigmaIntegration | null = null;

export function getFigmaIntegration(): FigmaIntegration {
  if (!instance) {
    instance = new FigmaIntegration();
  }
  return instance;
}

export async function initializeFigmaIntegration(
  accessToken?: string
): Promise<FigmaIntegration> {
  const integration = getFigmaIntegration();
  await integration.initialize(accessToken);
  return integration;
}

export default {
  FigmaIntegration,
  FigmaClient,
  FigmaCodeGenerator,
  getFigmaIntegration,
  initializeFigmaIntegration,
};
