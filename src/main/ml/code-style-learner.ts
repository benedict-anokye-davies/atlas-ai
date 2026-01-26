/**
 * Atlas Desktop - Code Style Learner
 * Learn user's coding style preferences
 *
 * Features:
 * - Indentation preferences
 * - Naming conventions
 * - Comment style
 * - Import organization
 * - Code structure patterns
 *
 * @module ml/code-style-learner
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('CodeStyleLearner');

// ============================================================================
// Types
// ============================================================================

export interface CodeStyleProfile {
  id: string;
  language: string;
  preferences: CodePreferences;
  sampleCount: number;
  confidence: number;
  lastUpdated: number;
}

export interface CodePreferences {
  // Indentation
  indentation: {
    type: 'spaces' | 'tabs';
    size: number;
    confidence: number;
  };

  // Quotes
  quotes: {
    type: 'single' | 'double';
    template: boolean;
    confidence: number;
  };

  // Semicolons
  semicolons: {
    use: boolean;
    confidence: number;
  };

  // Naming conventions
  naming: {
    variables: 'camelCase' | 'snake_case' | 'PascalCase';
    functions: 'camelCase' | 'snake_case' | 'PascalCase';
    classes: 'camelCase' | 'snake_case' | 'PascalCase';
    constants: 'UPPER_SNAKE' | 'camelCase' | 'PascalCase';
    confidence: number;
  };

  // Line length
  lineLength: {
    preferred: number;
    max: number;
    confidence: number;
  };

  // Braces
  braces: {
    style: 'same-line' | 'new-line';
    confidence: number;
  };

  // Comments
  comments: {
    style: 'line' | 'block' | 'jsdoc';
    preferJsdoc: boolean;
    confidence: number;
  };

  // Imports
  imports: {
    grouped: boolean;
    sorted: boolean;
    confidence: number;
  };

  // Trailing commas
  trailingCommas: {
    use: boolean;
    confidence: number;
  };

  // Arrow functions
  arrowFunctions: {
    preferArrow: boolean;
    implicitReturn: boolean;
    confidence: number;
  };
}

export interface CodeSample {
  content: string;
  language: string;
  filePath?: string;
  timestamp: number;
}

export interface StyleAnalysisResult {
  language: string;
  detectedPreferences: Partial<CodePreferences>;
  confidence: number;
  issues: StyleIssue[];
}

export interface StyleIssue {
  type: string;
  message: string;
  line?: number;
  expected?: string;
  actual?: string;
}

export interface CodeStyleConfig {
  minSamplesForConfidence: number;
  confidenceThreshold: number;
  maxSamplesPerLanguage: number;
}

export interface CodeStyleEvents {
  'profile-updated': (profile: CodeStyleProfile) => void;
  'style-learned': (language: string, preferences: Partial<CodePreferences>) => void;
  'style-violation': (issue: StyleIssue) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Code Style Learner
// ============================================================================

export class CodeStyleLearner extends EventEmitter {
  private config: CodeStyleConfig;
  private profiles: Map<string, CodeStyleProfile> = new Map();
  private samples: Map<string, CodeSample[]> = new Map();
  private dataPath: string;

  // Stats
  private stats = {
    samplesAnalyzed: 0,
    profilesCreated: 0,
    violationsDetected: 0,
  };

  constructor(config?: Partial<CodeStyleConfig>) {
    super();
    this.config = {
      minSamplesForConfidence: 5,
      confidenceThreshold: 0.7,
      maxSamplesPerLanguage: 100,
      ...config,
    };

    this.dataPath = path.join(app.getPath('userData'), 'code-style-profiles.json');
    this.loadData();

    logger.info('CodeStyleLearner initialized', { config: this.config });
  }

  // ============================================================================
  // Data Persistence
  // ============================================================================

  private loadData(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));

        for (const profile of data.profiles || []) {
          this.profiles.set(profile.language, profile);
        }

        logger.info('Loaded code style profiles', { count: this.profiles.size });
      }
    } catch (error) {
      logger.warn('Failed to load code style data', { error });
    }
  }

  private saveData(): void {
    try {
      const data = {
        profiles: Array.from(this.profiles.values()),
        savedAt: Date.now(),
      };
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.warn('Failed to save code style data', { error });
    }
  }

  // ============================================================================
  // Learning
  // ============================================================================

  /**
   * Learn from a code sample
   */
  learn(sample: CodeSample): StyleAnalysisResult {
    this.stats.samplesAnalyzed++;

    // Store sample
    const langSamples = this.samples.get(sample.language) || [];
    langSamples.push(sample);
    if (langSamples.length > this.config.maxSamplesPerLanguage) {
      langSamples.shift();
    }
    this.samples.set(sample.language, langSamples);

    // Analyze sample
    const analysis = this.analyzeCode(sample.content, sample.language);

    // Update profile
    this.updateProfile(sample.language, analysis.detectedPreferences);

    return analysis;
  }

  /**
   * Analyze code to extract style preferences
   */
  analyzeCode(content: string, language: string): StyleAnalysisResult {
    const lines = content.split('\n');
    const preferences: Partial<CodePreferences> = {};
    const issues: StyleIssue[] = [];

    // Analyze indentation
    preferences.indentation = this.analyzeIndentation(lines);

    // Analyze quotes (for JS/TS)
    if (['javascript', 'typescript', 'jsx', 'tsx'].includes(language)) {
      preferences.quotes = this.analyzeQuotes(content);
      preferences.semicolons = this.analyzeSemicolons(lines);
      preferences.arrowFunctions = this.analyzeArrowFunctions(content);
    }

    // Analyze naming conventions
    preferences.naming = this.analyzeNaming(content, language);

    // Analyze line length
    preferences.lineLength = this.analyzeLineLength(lines);

    // Analyze braces style
    preferences.braces = this.analyzeBraces(lines);

    // Analyze comments
    preferences.comments = this.analyzeComments(content);

    // Analyze imports
    preferences.imports = this.analyzeImports(content, language);

    // Analyze trailing commas
    preferences.trailingCommas = this.analyzeTrailingCommas(content);

    // Calculate overall confidence
    const confidences = Object.values(preferences)
      .filter((p): p is { confidence: number } => p !== undefined && 'confidence' in p)
      .map((p) => p.confidence);
    const avgConfidence = confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;

    return {
      language,
      detectedPreferences: preferences,
      confidence: avgConfidence,
      issues,
    };
  }

  /**
   * Analyze indentation style
   */
  private analyzeIndentation(lines: string[]): CodePreferences['indentation'] {
    let tabCount = 0;
    let spaceCount = 0;
    const spaceSizes: number[] = [];

    for (const line of lines) {
      if (line.length === 0) continue;

      const leadingWhitespace = line.match(/^[\t ]+/);
      if (leadingWhitespace) {
        const ws = leadingWhitespace[0];
        if (ws.includes('\t')) {
          tabCount++;
        } else {
          spaceCount++;
          spaceSizes.push(ws.length);
        }
      }
    }

    const type = tabCount > spaceCount ? 'tabs' : 'spaces';

    // Detect common space size (2 or 4)
    let size = 2;
    if (spaceSizes.length > 0) {
      const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
      const commonDivisor = spaceSizes.reduce(gcd);
      size = commonDivisor > 0 && commonDivisor <= 4 ? commonDivisor : 2;
    }

    const total = tabCount + spaceCount;
    const confidence = total > 0 ? Math.max(tabCount, spaceCount) / total : 0.5;

    return { type, size, confidence };
  }

  /**
   * Analyze quote style
   */
  private analyzeQuotes(content: string): CodePreferences['quotes'] {
    const singleQuotes = (content.match(/'/g) || []).length;
    const doubleQuotes = (content.match(/"/g) || []).length;
    const templateLiterals = (content.match(/`/g) || []).length;

    const type = singleQuotes > doubleQuotes ? 'single' : 'double';
    const template = templateLiterals > 0;
    const total = singleQuotes + doubleQuotes;
    const confidence = total > 0 ? Math.max(singleQuotes, doubleQuotes) / total : 0.5;

    return { type, template, confidence };
  }

  /**
   * Analyze semicolon usage
   */
  private analyzeSemicolons(lines: string[]): CodePreferences['semicolons'] {
    let withSemi = 0;
    let withoutSemi = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
      if (trimmed.endsWith('{') || trimmed.endsWith('}') || trimmed.endsWith(',')) continue;

      if (trimmed.endsWith(';')) {
        withSemi++;
      } else if (trimmed.match(/^(const|let|var|return|import|export)/)) {
        withoutSemi++;
      }
    }

    const total = withSemi + withoutSemi;
    const use = withSemi > withoutSemi;
    const confidence = total > 0 ? Math.max(withSemi, withoutSemi) / total : 0.5;

    return { use, confidence };
  }

  /**
   * Analyze naming conventions
   */
  private analyzeNaming(content: string, _language: string): CodePreferences['naming'] {
    // Extract identifiers
    const variableMatches = content.match(/(?:const|let|var)\s+(\w+)/g) || [];
    const functionMatches = content.match(/function\s+(\w+)/g) || [];
    const classMatches = content.match(/class\s+(\w+)/g) || [];
    const constantMatches = content.match(/const\s+([A-Z_]+)\s*=/g) || [];

    const detectConvention = (names: string[]): 'camelCase' | 'snake_case' | 'PascalCase' => {
      let camel = 0;
      let snake = 0;
      let pascal = 0;

      for (const name of names) {
        if (name.includes('_')) {
          snake++;
        } else if (name[0] === name[0].toUpperCase()) {
          pascal++;
        } else {
          camel++;
        }
      }

      if (snake >= camel && snake >= pascal) return 'snake_case';
      if (pascal >= camel) return 'PascalCase';
      return 'camelCase';
    };

    const varNames = variableMatches.map((m) => m.split(/\s+/)[1]);
    const funcNames = functionMatches.map((m) => m.split(/\s+/)[1]);
    const classNames = classMatches.map((m) => m.split(/\s+/)[1]);

    return {
      variables: detectConvention(varNames),
      functions: detectConvention(funcNames),
      classes: detectConvention(classNames),
      constants: constantMatches.length > 0 ? 'UPPER_SNAKE' : 'camelCase',
      confidence: (varNames.length + funcNames.length + classNames.length) > 5 ? 0.8 : 0.5,
    };
  }

  /**
   * Analyze line length preferences
   */
  private analyzeLineLength(lines: string[]): CodePreferences['lineLength'] {
    const lengths = lines.map((l) => l.length).filter((l) => l > 0);

    if (lengths.length === 0) {
      return { preferred: 80, max: 120, confidence: 0.5 };
    }

    lengths.sort((a, b) => a - b);
    const median = lengths[Math.floor(lengths.length / 2)];
    const max = Math.max(...lengths);

    // Round to common values
    const preferred = median < 70 ? 80 : median < 100 ? 100 : 120;

    return {
      preferred,
      max,
      confidence: lengths.length > 10 ? 0.8 : 0.5,
    };
  }

  /**
   * Analyze brace style
   */
  private analyzeBraces(lines: string[]): CodePreferences['braces'] {
    let sameLine = 0;
    let newLine = 0;

    for (let i = 0; i < lines.length - 1; i++) {
      const current = lines[i].trim();
      const next = lines[i + 1].trim();

      if (current.endsWith('{')) {
        sameLine++;
      } else if (next === '{' && (current.endsWith(')') || current.match(/\b(if|for|while|function|class)\b/))) {
        newLine++;
      }
    }

    const total = sameLine + newLine;
    const style = newLine > sameLine ? 'new-line' : 'same-line';
    const confidence = total > 0 ? Math.max(sameLine, newLine) / total : 0.5;

    return { style, confidence };
  }

  /**
   * Analyze comment style
   */
  private analyzeComments(content: string): CodePreferences['comments'] {
    const lineComments = (content.match(/\/\//g) || []).length;
    const blockComments = (content.match(/\/\*/g) || []).length;
    const jsdocComments = (content.match(/\/\*\*/g) || []).length;

    let style: 'line' | 'block' | 'jsdoc' = 'line';
    if (jsdocComments > lineComments && jsdocComments > blockComments) {
      style = 'jsdoc';
    } else if (blockComments > lineComments) {
      style = 'block';
    }

    const total = lineComments + blockComments + jsdocComments;
    const confidence = total > 5 ? 0.8 : 0.5;

    return {
      style,
      preferJsdoc: jsdocComments > 0,
      confidence,
    };
  }

  /**
   * Analyze import organization
   */
  private analyzeImports(content: string, language: string): CodePreferences['imports'] {
    if (!['javascript', 'typescript', 'jsx', 'tsx'].includes(language)) {
      return { grouped: false, sorted: false, confidence: 0.5 };
    }

    const importLines = content.split('\n').filter((l) => l.trim().startsWith('import'));

    if (importLines.length < 2) {
      return { grouped: false, sorted: false, confidence: 0.5 };
    }

    // Check if sorted alphabetically
    const importPaths = importLines
      .map((l) => l.match(/from\s+['"]([^'"]+)['"]/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => m[1]);

    const sortedPaths = [...importPaths].sort();
    const sorted = JSON.stringify(importPaths) === JSON.stringify(sortedPaths);

    // Check if grouped (external vs internal)
    const hasGroups = importLines.some(
      (l, i) => i > 0 && importLines[i - 1].trim() === '' && l.trim().startsWith('import')
    );

    return {
      grouped: hasGroups,
      sorted,
      confidence: importLines.length > 5 ? 0.8 : 0.6,
    };
  }

  /**
   * Analyze trailing commas
   */
  private analyzeTrailingCommas(content: string): CodePreferences['trailingCommas'] {
    // Look for arrays and objects with trailing commas
    const withTrailing = (content.match(/,\s*[\]\}]/g) || []).length;
    const withoutTrailing = (content.match(/[^\s,]\s*[\]\}]/g) || []).length;

    const total = withTrailing + withoutTrailing;
    const use = withTrailing > withoutTrailing;
    const confidence = total > 5 ? 0.7 : 0.5;

    return { use, confidence };
  }

  /**
   * Analyze arrow function usage
   */
  private analyzeArrowFunctions(content: string): CodePreferences['arrowFunctions'] {
    const arrowFuncs = (content.match(/=>\s*[{(]/g) || []).length;
    const regularFuncs = (content.match(/function\s*\(/g) || []).length;
    const implicitReturn = (content.match(/=>\s*[^{]/g) || []).length;

    const total = arrowFuncs + regularFuncs;
    const preferArrow = arrowFuncs > regularFuncs;
    const confidence = total > 3 ? 0.7 : 0.5;

    return {
      preferArrow,
      implicitReturn: implicitReturn > 0,
      confidence,
    };
  }

  // ============================================================================
  // Profile Management
  // ============================================================================

  /**
   * Update language profile with new preferences
   */
  private updateProfile(language: string, newPrefs: Partial<CodePreferences>): void {
    let profile = this.profiles.get(language);

    if (!profile) {
      profile = {
        id: `profile_${language}_${Date.now()}`,
        language,
        preferences: this.getDefaultPreferences(),
        sampleCount: 0,
        confidence: 0,
        lastUpdated: Date.now(),
      };
      this.profiles.set(language, profile);
      this.stats.profilesCreated++;
    }

    // Merge preferences with weighted average
    profile.sampleCount++;
    const weight = 1 / profile.sampleCount;

    for (const [key, value] of Object.entries(newPrefs) as [keyof CodePreferences, any][]) {
      if (value && profile.preferences[key]) {
        // Merge with existing
        const existing = profile.preferences[key] as Record<string, unknown>;
        const incoming = value as Record<string, unknown>;

        for (const [propKey, propValue] of Object.entries(incoming)) {
          if (propKey === 'confidence') {
            (existing as Record<string, number>)[propKey] =
              ((existing as Record<string, number>)[propKey] || 0) * (1 - weight) + (propValue as number) * weight;
          } else if (typeof propValue === 'number') {
            (existing as Record<string, number>)[propKey] =
              ((existing as Record<string, number>)[propKey] || 0) * (1 - weight) + propValue * weight;
          } else {
            // For discrete values, keep most confident
            if ((incoming.confidence as number) > ((existing.confidence as number) || 0)) {
              (existing as Record<string, unknown>)[propKey] = propValue;
            }
          }
        }
      }
    }

    profile.lastUpdated = Date.now();

    // Calculate overall confidence
    const confidences = Object.values(profile.preferences)
      .filter((p): p is { confidence: number } => 'confidence' in p)
      .map((p) => p.confidence);
    profile.confidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;

    this.emit('profile-updated', profile);
    this.emit('style-learned', language, newPrefs);

    this.saveData();
  }

  /**
   * Get default preferences
   */
  private getDefaultPreferences(): CodePreferences {
    return {
      indentation: { type: 'spaces', size: 2, confidence: 0.5 },
      quotes: { type: 'single', template: true, confidence: 0.5 },
      semicolons: { use: true, confidence: 0.5 },
      naming: {
        variables: 'camelCase',
        functions: 'camelCase',
        classes: 'PascalCase',
        constants: 'UPPER_SNAKE',
        confidence: 0.5,
      },
      lineLength: { preferred: 80, max: 120, confidence: 0.5 },
      braces: { style: 'same-line', confidence: 0.5 },
      comments: { style: 'line', preferJsdoc: true, confidence: 0.5 },
      imports: { grouped: true, sorted: true, confidence: 0.5 },
      trailingCommas: { use: true, confidence: 0.5 },
      arrowFunctions: { preferArrow: true, implicitReturn: true, confidence: 0.5 },
    };
  }

  // ============================================================================
  // Style Checking
  // ============================================================================

  /**
   * Check code against learned style
   */
  checkStyle(content: string, language: string): StyleIssue[] {
    const profile = this.profiles.get(language);
    if (!profile || profile.confidence < this.config.confidenceThreshold) {
      return [];
    }

    const issues: StyleIssue[] = [];
    const lines = content.split('\n');
    const prefs = profile.preferences;

    // Check indentation
    if (prefs.indentation.confidence >= this.config.confidenceThreshold) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const leadingWs = line.match(/^[\t ]+/)?.[0] || '';

        if (prefs.indentation.type === 'spaces' && leadingWs.includes('\t')) {
          issues.push({
            type: 'indentation',
            message: 'Use spaces for indentation',
            line: i + 1,
            expected: 'spaces',
            actual: 'tabs',
          });
        } else if (prefs.indentation.type === 'tabs' && leadingWs.includes(' ') && !leadingWs.includes('\t')) {
          issues.push({
            type: 'indentation',
            message: 'Use tabs for indentation',
            line: i + 1,
            expected: 'tabs',
            actual: 'spaces',
          });
        }
      }
    }

    // Check line length
    if (prefs.lineLength.confidence >= this.config.confidenceThreshold) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].length > prefs.lineLength.max) {
          issues.push({
            type: 'line-length',
            message: `Line exceeds max length of ${prefs.lineLength.max}`,
            line: i + 1,
            expected: String(prefs.lineLength.max),
            actual: String(lines[i].length),
          });
        }
      }
    }

    this.stats.violationsDetected += issues.length;

    for (const issue of issues) {
      this.emit('style-violation', issue);
    }

    return issues;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Get profile for language
   */
  getProfile(language: string): CodeStyleProfile | undefined {
    return this.profiles.get(language);
  }

  /**
   * Get all profiles
   */
  getAllProfiles(): CodeStyleProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Reset profile
   */
  resetProfile(language: string): void {
    this.profiles.delete(language);
    this.samples.delete(language);
    this.saveData();
    logger.info('Profile reset', { language });
  }

  /**
   * Get statistics
   */
  getStats(): {
    samplesAnalyzed: number;
    profilesCreated: number;
    violationsDetected: number;
    languagesLearned: number;
  } {
    return {
      ...this.stats,
      languagesLearned: this.profiles.size,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CodeStyleConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Config updated', { config: this.config });
  }
}

// ============================================================================
// Singleton
// ============================================================================

let codeStyleLearner: CodeStyleLearner | null = null;

export function getCodeStyleLearner(): CodeStyleLearner {
  if (!codeStyleLearner) {
    codeStyleLearner = new CodeStyleLearner();
  }
  return codeStyleLearner;
}
