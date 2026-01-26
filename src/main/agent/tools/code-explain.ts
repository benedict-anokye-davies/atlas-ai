/**
 * Code Explain Tool
 * 
 * Provides semantic code explanation using LLM analysis.
 * Supports explaining functions, classes, blocks of code,
 * and overall file structure.
 * 
 * @module agent/tools/code-explain
 */

import * as fs from 'fs';
import * as path from 'path';
import { createModuleLogger } from '../../utils/logger';
import { getLLMManager } from '../../llm/manager';

const logger = createModuleLogger('CodeExplain');

// ============================================================================
// Types
// ============================================================================

export interface CodeExplanation {
  summary: string;
  purpose: string;
  keyPoints: string[];
  complexity: 'simple' | 'moderate' | 'complex';
  dependencies?: string[];
  sideEffects?: string[];
  improvements?: string[];
}

export interface FunctionExplanation extends CodeExplanation {
  parameters: Array<{
    name: string;
    type?: string;
    description: string;
  }>;
  returnValue: {
    type?: string;
    description: string;
  };
  examples?: string[];
}

export interface ClassExplanation extends CodeExplanation {
  methods: Array<{
    name: string;
    visibility: string;
    description: string;
  }>;
  properties: Array<{
    name: string;
    type?: string;
    description: string;
  }>;
  inheritance?: string[];
  patterns?: string[];
}

export interface FileExplanation extends CodeExplanation {
  exports: string[];
  imports: string[];
  structure: Array<{
    name: string;
    type: string;
    line: number;
    description: string;
  }>;
}

export type ExplanationLevel = 'brief' | 'detailed' | 'expert';

// ============================================================================
// Explanation Functions
// ============================================================================

/**
 * Explain a code snippet
 */
export async function explainCode(
  code: string,
  options?: {
    language?: string;
    level?: ExplanationLevel;
    context?: string;
  }
): Promise<CodeExplanation> {
  const { language = detectLanguage(code), level = 'detailed', context } = options || {};
  
  const llm = getLLMManager();
  
  const prompt = buildExplanationPrompt(code, {
    language,
    level,
    context,
    type: 'code',
  });
  
  try {
    const response = await llm.chat([
      { role: 'system', content: getSystemPrompt(level) },
      { role: 'user', content: prompt },
    ]);
    
    return parseExplanationResponse(response.content);
  } catch (error) {
    logger.error('Code explanation failed:', error);
    throw new Error('Failed to generate code explanation');
  }
}

/**
 * Explain a function
 */
export async function explainFunction(
  code: string,
  functionName: string,
  options?: {
    language?: string;
    level?: ExplanationLevel;
  }
): Promise<FunctionExplanation> {
  const { language = detectLanguage(code), level = 'detailed' } = options || {};
  
  // Extract the function code
  const functionCode = extractFunction(code, functionName);
  if (!functionCode) {
    throw new Error(`Function "${functionName}" not found in code`);
  }
  
  const llm = getLLMManager();
  
  const prompt = buildFunctionExplanationPrompt(functionCode, functionName, language, level);
  
  try {
    const response = await llm.chat([
      { role: 'system', content: getSystemPrompt(level) },
      { role: 'user', content: prompt },
    ]);
    
    return parseFunctionExplanationResponse(response.content);
  } catch (error) {
    logger.error('Function explanation failed:', error);
    throw new Error('Failed to generate function explanation');
  }
}

/**
 * Explain a class
 */
export async function explainClass(
  code: string,
  className: string,
  options?: {
    language?: string;
    level?: ExplanationLevel;
  }
): Promise<ClassExplanation> {
  const { language = detectLanguage(code), level = 'detailed' } = options || {};
  
  // Extract the class code
  const classCode = extractClass(code, className);
  if (!classCode) {
    throw new Error(`Class "${className}" not found in code`);
  }
  
  const llm = getLLMManager();
  
  const prompt = buildClassExplanationPrompt(classCode, className, language, level);
  
  try {
    const response = await llm.chat([
      { role: 'system', content: getSystemPrompt(level) },
      { role: 'user', content: prompt },
    ]);
    
    return parseClassExplanationResponse(response.content);
  } catch (error) {
    logger.error('Class explanation failed:', error);
    throw new Error('Failed to generate class explanation');
  }
}

/**
 * Explain a file's structure and purpose
 */
export async function explainFile(
  filePath: string,
  options?: {
    level?: ExplanationLevel;
  }
): Promise<FileExplanation> {
  const { level = 'detailed' } = options || {};
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  
  const code = fs.readFileSync(filePath, 'utf-8');
  const language = detectLanguageFromPath(filePath);
  
  const llm = getLLMManager();
  
  const prompt = buildFileExplanationPrompt(code, path.basename(filePath), language, level);
  
  try {
    const response = await llm.chat([
      { role: 'system', content: getSystemPrompt(level) },
      { role: 'user', content: prompt },
    ]);
    
    return parseFileExplanationResponse(response.content);
  } catch (error) {
    logger.error('File explanation failed:', error);
    throw new Error('Failed to generate file explanation');
  }
}

/**
 * Generate inline comments for code
 */
export async function generateComments(
  code: string,
  options?: {
    language?: string;
    style?: 'jsdoc' | 'inline' | 'block';
  }
): Promise<string> {
  const { language = detectLanguage(code), style = 'jsdoc' } = options || {};
  
  const llm = getLLMManager();
  
  const prompt = `Add ${style} comments to this ${language} code to explain what it does.
Keep comments concise but informative. Do not change the code itself, only add comments.

Code:
\`\`\`${language}
${code}
\`\`\`

Return only the commented code, no additional explanation.`;

  try {
    const response = await llm.chat([
      { role: 'system', content: 'You are an expert code documenter. Add clear, concise comments to code.' },
      { role: 'user', content: prompt },
    ]);
    
    // Extract code from response
    const codeMatch = response.content.match(/```[\w]*\n([\s\S]*?)```/);
    return codeMatch ? codeMatch[1].trim() : response.content;
  } catch (error) {
    logger.error('Comment generation failed:', error);
    throw new Error('Failed to generate comments');
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get system prompt based on explanation level
 */
function getSystemPrompt(level: ExplanationLevel): string {
  switch (level) {
    case 'brief':
      return `You are a code explanation assistant. Provide brief, concise explanations suitable for experienced developers. Focus on the what and why, skip obvious details.`;
    
    case 'expert':
      return `You are an expert code analyst. Provide deep technical analysis including performance implications, design patterns, potential issues, and architectural considerations.`;
    
    case 'detailed':
    default:
      return `You are a helpful code explanation assistant. Provide clear, detailed explanations that help developers understand code. Include purpose, key logic, and any important considerations.`;
  }
}

/**
 * Build explanation prompt
 */
function buildExplanationPrompt(
  code: string,
  options: {
    language: string;
    level: ExplanationLevel;
    context?: string;
    type: string;
  }
): string {
  const { language, level, context, type } = options;
  
  let prompt = `Explain the following ${language} ${type}:

\`\`\`${language}
${code}
\`\`\`

`;

  if (context) {
    prompt += `Context: ${context}\n\n`;
  }
  
  prompt += `Provide your explanation in the following JSON format:
{
  "summary": "One sentence summary",
  "purpose": "What this code is designed to do",
  "keyPoints": ["Key point 1", "Key point 2"],
  "complexity": "simple|moderate|complex",
  "dependencies": ["Dependency 1"],
  "sideEffects": ["Side effect if any"],
  "improvements": ["Potential improvement"]
}`;

  return prompt;
}

/**
 * Build function explanation prompt
 */
function buildFunctionExplanationPrompt(
  code: string,
  functionName: string,
  language: string,
  level: ExplanationLevel
): string {
  return `Explain this ${language} function "${functionName}":

\`\`\`${language}
${code}
\`\`\`

Provide your explanation in the following JSON format:
{
  "summary": "One sentence summary",
  "purpose": "What this function does",
  "parameters": [
    {"name": "paramName", "type": "type", "description": "What it's for"}
  ],
  "returnValue": {"type": "type", "description": "What it returns"},
  "keyPoints": ["Key implementation detail"],
  "complexity": "simple|moderate|complex",
  "dependencies": ["External dependencies"],
  "sideEffects": ["Side effects if any"],
  "examples": ["Example usage"],
  "improvements": ["Potential improvement"]
}`;
}

/**
 * Build class explanation prompt
 */
function buildClassExplanationPrompt(
  code: string,
  className: string,
  language: string,
  level: ExplanationLevel
): string {
  return `Explain this ${language} class "${className}":

\`\`\`${language}
${code}
\`\`\`

Provide your explanation in the following JSON format:
{
  "summary": "One sentence summary",
  "purpose": "What this class represents",
  "methods": [
    {"name": "methodName", "visibility": "public|private", "description": "What it does"}
  ],
  "properties": [
    {"name": "propName", "type": "type", "description": "What it stores"}
  ],
  "inheritance": ["Parent class or interfaces"],
  "patterns": ["Design patterns used"],
  "keyPoints": ["Key design decision"],
  "complexity": "simple|moderate|complex",
  "improvements": ["Potential improvement"]
}`;
}

/**
 * Build file explanation prompt
 */
function buildFileExplanationPrompt(
  code: string,
  fileName: string,
  language: string,
  level: ExplanationLevel
): string {
  return `Explain this ${language} file "${fileName}":

\`\`\`${language}
${code}
\`\`\`

Provide your explanation in the following JSON format:
{
  "summary": "One sentence summary of file purpose",
  "purpose": "What this file/module does",
  "exports": ["Exported symbols"],
  "imports": ["Key dependencies"],
  "structure": [
    {"name": "symbolName", "type": "function|class|const", "line": 1, "description": "What it does"}
  ],
  "keyPoints": ["Key architectural decision"],
  "complexity": "simple|moderate|complex",
  "improvements": ["Potential improvement"]
}`;
}

/**
 * Parse explanation response
 */
function parseExplanationResponse(response: string): CodeExplanation {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // Parse failed, extract manually
  }
  
  return {
    summary: response.substring(0, 200),
    purpose: response,
    keyPoints: [],
    complexity: 'moderate',
  };
}

/**
 * Parse function explanation response
 */
function parseFunctionExplanationResponse(response: string): FunctionExplanation {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // Parse failed
  }
  
  return {
    summary: response.substring(0, 200),
    purpose: response,
    keyPoints: [],
    complexity: 'moderate',
    parameters: [],
    returnValue: { description: 'Unknown' },
  };
}

/**
 * Parse class explanation response
 */
function parseClassExplanationResponse(response: string): ClassExplanation {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // Parse failed
  }
  
  return {
    summary: response.substring(0, 200),
    purpose: response,
    keyPoints: [],
    complexity: 'moderate',
    methods: [],
    properties: [],
  };
}

/**
 * Parse file explanation response
 */
function parseFileExplanationResponse(response: string): FileExplanation {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // Parse failed
  }
  
  return {
    summary: response.substring(0, 200),
    purpose: response,
    keyPoints: [],
    complexity: 'moderate',
    exports: [],
    imports: [],
    structure: [],
  };
}

/**
 * Detect language from code content
 */
function detectLanguage(code: string): string {
  // Simple heuristics
  if (code.includes('import React') || code.includes('from "react"')) return 'typescript';
  if (code.includes(': string') || code.includes(': number') || code.includes('interface ')) return 'typescript';
  if (code.includes('def ') || code.includes('import ') && code.includes(':')) return 'python';
  if (code.includes('func ') || code.includes('package main')) return 'go';
  if (code.includes('fn ') || code.includes('let mut ')) return 'rust';
  if (code.includes('public class') || code.includes('private void')) return 'java';
  return 'javascript';
}

/**
 * Detect language from file path
 */
function detectLanguageFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.c': 'c',
    '.cpp': 'cpp',
    '.cs': 'csharp',
    '.rb': 'ruby',
    '.php': 'php',
    '.swift': 'swift',
    '.kt': 'kotlin',
  };
  return langMap[ext] || 'text';
}

/**
 * Extract a function from code
 */
function extractFunction(code: string, functionName: string): string | null {
  // Try different function patterns
  const patterns = [
    // Named function
    new RegExp(`((?:export\\s+)?(?:async\\s+)?function\\s+${functionName}\\s*\\([^)]*\\)[^{]*\\{)`, 'g'),
    // Arrow function
    new RegExp(`((?:export\\s+)?(?:const|let)\\s+${functionName}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*\\{?)`, 'g'),
    // Method in object/class
    new RegExp(`(${functionName}\\s*\\([^)]*\\)\\s*[:{])`, 'g'),
  ];
  
  for (const pattern of patterns) {
    const match = pattern.exec(code);
    if (match) {
      const startIndex = match.index;
      const braceContent = extractBraceContent(code, startIndex);
      if (braceContent) return braceContent;
    }
  }
  
  return null;
}

/**
 * Extract a class from code
 */
function extractClass(code: string, className: string): string | null {
  const pattern = new RegExp(`((?:export\\s+)?class\\s+${className}[^{]*\\{)`, 'g');
  const match = pattern.exec(code);
  
  if (match) {
    const startIndex = match.index;
    return extractBraceContent(code, startIndex);
  }
  
  return null;
}

/**
 * Extract content within braces starting from an index
 */
function extractBraceContent(code: string, startIndex: number): string | null {
  let braceCount = 0;
  let started = false;
  let endIndex = startIndex;
  
  for (let i = startIndex; i < code.length; i++) {
    const char = code[i];
    
    if (char === '{') {
      braceCount++;
      started = true;
    } else if (char === '}') {
      braceCount--;
    }
    
    if (started && braceCount === 0) {
      endIndex = i + 1;
      break;
    }
  }
  
  if (endIndex > startIndex) {
    return code.substring(startIndex, endIndex);
  }
  
  return null;
}

// ============================================================================
// Tool Export for Agent
// ============================================================================

export const codeExplainTools = {
  /**
   * Explain code snippet
   */
  explain_code: {
    name: 'explain_code',
    description: 'Explain what a piece of code does, including its purpose, key logic, and considerations',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The code to explain',
        },
        language: {
          type: 'string',
          description: 'Programming language (auto-detected if not specified)',
        },
        level: {
          type: 'string',
          enum: ['brief', 'detailed', 'expert'],
          description: 'Level of detail in explanation',
        },
      },
      required: ['code'],
    },
    execute: async (args: { code: string; language?: string; level?: ExplanationLevel }) => {
      const explanation = await explainCode(args.code, {
        language: args.language,
        level: args.level,
      });
      return { success: true, explanation };
    },
  },
  
  /**
   * Explain a specific function
   */
  explain_function: {
    name: 'explain_function',
    description: 'Explain a specific function including parameters, return value, and logic',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Code containing the function',
        },
        functionName: {
          type: 'string',
          description: 'Name of the function to explain',
        },
        level: {
          type: 'string',
          enum: ['brief', 'detailed', 'expert'],
        },
      },
      required: ['code', 'functionName'],
    },
    execute: async (args: { code: string; functionName: string; level?: ExplanationLevel }) => {
      const explanation = await explainFunction(args.code, args.functionName, {
        level: args.level,
      });
      return { success: true, explanation };
    },
  },
  
  /**
   * Explain a file
   */
  explain_file: {
    name: 'explain_file',
    description: 'Explain a file\'s structure, purpose, and exports',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the file to explain',
        },
        level: {
          type: 'string',
          enum: ['brief', 'detailed', 'expert'],
        },
      },
      required: ['filePath'],
    },
    execute: async (args: { filePath: string; level?: ExplanationLevel }) => {
      const explanation = await explainFile(args.filePath, {
        level: args.level,
      });
      return { success: true, explanation };
    },
  },
  
  /**
   * Generate comments for code
   */
  generate_comments: {
    name: 'generate_comments',
    description: 'Add documentation comments to code',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Code to add comments to',
        },
        style: {
          type: 'string',
          enum: ['jsdoc', 'inline', 'block'],
          description: 'Comment style to use',
        },
      },
      required: ['code'],
    },
    execute: async (args: { code: string; style?: 'jsdoc' | 'inline' | 'block' }) => {
      const commentedCode = await generateComments(args.code, {
        style: args.style,
      });
      return { success: true, code: commentedCode };
    },
  },
};

export default codeExplainTools;
