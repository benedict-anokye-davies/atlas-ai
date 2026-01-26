/**
 * Atlas Desktop - Calculator Skill
 * Session 043-A: Built-in skill example
 *
 * Provides mathematical calculation capabilities.
 */

import { BaseSkill } from './base-skill';
import type {
  SkillMetadata,
  SkillTrigger,
  SkillCapabilities,
  SkillContext,
  SkillResult,
} from '../../../shared/types/skill';
import type { AgentTool } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import { getErrorMessage } from '../../../shared/utils';

const logger = createModuleLogger('calculator-skill');

/**
 * Calculator Skill
 * Handles mathematical calculations from natural language queries
 */
export class CalculatorSkill extends BaseSkill {
  readonly id = 'calculator';

  readonly metadata: SkillMetadata = {
    displayName: 'Calculator',
    description: 'Perform mathematical calculations',
    longDescription:
      'A versatile calculator that can handle basic arithmetic, percentages, unit conversions, and more. Just ask naturally like "What is 15% of 200?" or "Calculate 5 plus 3 times 2".',
    version: '1.0.0',
    icon: 'calculator',
    category: 'productivity',
    tags: ['math', 'calculate', 'arithmetic', 'percentage', 'convert'],
    exampleQueries: [
      'What is 25 plus 17?',
      'Calculate 15% of 200',
      'What is the square root of 144?',
      '5 times 3 plus 2',
      'Convert 100 fahrenheit to celsius',
    ],
    builtIn: true,
  };

  readonly triggers: SkillTrigger[] = [
    {
      type: 'keyword',
      keywords: [
        'calculate',
        'math',
        'plus',
        'minus',
        'times',
        'divided',
        'multiply',
        'add',
        'subtract',
        'percent',
        'percentage',
        'square root',
        'power',
        'squared',
        'cubed',
      ],
      priority: 1,
    },
    {
      type: 'intent',
      intents: ['math', 'calculate', 'arithmetic'],
      priority: 1,
    },
  ];

  readonly capabilities: SkillCapabilities = {
    required: ['conversation'],
    optional: [],
    requiresInternet: false,
    offlineCapable: true,
  };

  /**
   * Check if should handle with enhanced matching for math expressions
   */
  async shouldHandle(context: SkillContext): Promise<number> {
    const query = context.query.toLowerCase();

    // Check for math-related keywords
    const baseScore = await super.shouldHandle(context);

    // Additional check for number patterns
    const hasNumbers = /\d+/.test(query);
    const hasMathOperators =
      /[+\-*/^%]/.test(query) || /\b(plus|minus|times|divided|multiply|add|subtract)\b/.test(query);
    const hasQuestionWords = /\b(what|how much|calculate|compute)\b/.test(query);

    if (hasNumbers && (hasMathOperators || hasQuestionWords)) {
      return Math.max(baseScore, 0.7);
    }

    if (hasNumbers && baseScore > 0) {
      return Math.max(baseScore, 0.5);
    }

    return baseScore;
  }

  /**
   * Execute the calculation
   */
  async execute(context: SkillContext): Promise<SkillResult> {
    logger.info(`[Calculator] Processing query: ${context.query}`);

    try {
      // Parse the query to extract math expression
      const expression = this.parseExpression(context.query);

      if (!expression) {
        return this.failure(
          'Could not understand the mathematical expression. Please try rephrasing.'
        );
      }

      // Evaluate the expression
      const result = this.evaluate(expression);

      // Format the response
      const response = this.formatResponse(context.query, expression, result);

      return this.success({ expression, result }, response);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error(`[Calculator] Error: ${errorMessage}`);
      return this.failure(`Calculation error: ${errorMessage}`);
    }
  }

  /**
   * Register calculator tool
   */
  protected registerTools(): AgentTool[] {
    return [
      {
        name: 'calculate',
        description: 'Perform a mathematical calculation',
        parameters: {
          type: 'object',
          properties: {
            expression: {
              type: 'string',
              description: 'The mathematical expression to evaluate',
            },
          },
          required: ['expression'],
        },
        execute: async (params: Record<string, unknown>) => {
          const expression = params.expression as string;
          try {
            const result = this.evaluate(expression);
            return {
              success: true,
              data: { expression, result },
            };
          } catch (error) {
            return {
              success: false,
              error: getErrorMessage(error),
            };
          }
        },
      },
    ];
  }

  /**
   * Parse natural language query into math expression
   */
  private parseExpression(query: string): string | null {
    let expr = query.toLowerCase();

    // Remove question words and common phrases
    expr = expr
      .replace(/^(what is|what's|calculate|compute|how much is|tell me)\s*/i, '')
      .replace(/\?$/g, '')
      .trim();

    // Convert word operators to symbols
    expr = expr
      .replace(/\bplus\b/g, '+')
      .replace(/\badd\b/g, '+')
      .replace(/\band\b/g, '+')
      .replace(/\bminus\b/g, '-')
      .replace(/\bsubtract\b/g, '-')
      .replace(/\btimes\b/g, '*')
      .replace(/\bmultiply\b/g, '*')
      .replace(/\bmultiplied by\b/g, '*')
      .replace(/\bdivided by\b/g, '/')
      .replace(/\bdivide\b/g, '/')
      .replace(/\bover\b/g, '/')
      .replace(/\bto the power of\b/g, '^')
      .replace(/\bsquared\b/g, '^2')
      .replace(/\bcubed\b/g, '^3');

    // Handle percentages
    const percentMatch = expr.match(/(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)/);
    if (percentMatch) {
      const percent = parseFloat(percentMatch[1]);
      const value = parseFloat(percentMatch[2]);
      return `(${percent} / 100) * ${value}`;
    }

    // Handle square root
    expr = expr.replace(/\bsquare root of\s*(\d+(?:\.\d+)?)/g, 'Math.sqrt($1)');
    expr = expr.replace(/\bsqrt\s*(\d+(?:\.\d+)?)/g, 'Math.sqrt($1)');

    // Handle temperature conversion
    const fahrenheitMatch = expr.match(/(\d+(?:\.\d+)?)\s*fahrenheit\s*to\s*celsius/);
    if (fahrenheitMatch) {
      const f = parseFloat(fahrenheitMatch[1]);
      return `(${f} - 32) * 5 / 9`;
    }

    const celsiusMatch = expr.match(/(\d+(?:\.\d+)?)\s*celsius\s*to\s*fahrenheit/);
    if (celsiusMatch) {
      const c = parseFloat(celsiusMatch[1]);
      return `${c} * 9 / 5 + 32`;
    }

    // Clean up extra spaces
    expr = expr.replace(/\s+/g, ' ').trim();

    // Check if we have a valid-looking expression
    if (!/[\d]/.test(expr)) {
      return null;
    }

    // Remove any remaining words (keep only numbers and operators)
    expr = expr
      .replace(/[a-z]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return expr || null;
  }

  /**
   * Safely evaluate a math expression
   */
  private evaluate(expression: string): number {
    // Replace ^ with ** for exponentiation
    const safeExpr = expression.replace(/\^/g, '**');

    // Validate expression only contains safe characters
    if (!/^[\d\s+\-*/().%*Math.sqrt]+$/.test(safeExpr)) {
      throw new Error('Invalid expression');
    }

    // Use Function constructor for safe evaluation
    // This is safer than eval() but still needs the validation above
    try {
      const fn = new Function('Math', `return ${safeExpr}`);
      const result = fn(Math);

      if (typeof result !== 'number' || !isFinite(result)) {
        throw new Error('Result is not a valid number');
      }

      return result;
    } catch {
      throw new Error('Could not evaluate expression');
    }
  }

  /**
   * Format the response
   */
  private formatResponse(query: string, expression: string, result: number): string {
    // Round to reasonable precision
    const formattedResult = Number.isInteger(result)
      ? result.toString()
      : result.toFixed(4).replace(/\.?0+$/, '');

    // Check if it was a percentage question
    if (query.toLowerCase().includes('%')) {
      return `That's ${formattedResult}`;
    }

    // Check if it was a conversion
    if (query.toLowerCase().includes('fahrenheit') || query.toLowerCase().includes('celsius')) {
      const unit = query.toLowerCase().includes('to celsius') ? 'Celsius' : 'Fahrenheit';
      return `That's ${formattedResult} degrees ${unit}`;
    }

    return `The answer is ${formattedResult}`;
  }
}

export default CalculatorSkill;
