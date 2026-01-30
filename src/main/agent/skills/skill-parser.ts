/**
 * @fileoverview SKILL.md Parser for Clawdbot-compatible skill files
 * @module skills/skill-parser
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Parses SKILL.md files in Clawdbot format to extract skill metadata,
 * tools, prompts, and gating requirements. This enables loading external
 * skills that follow the Clawdbot skill specification.
 *
 * @example
 * import { SkillParser } from './skill-parser';
 *
 * const parser = new SkillParser();
 * const parsed = await parser.parseFile('/path/to/SKILL.md');
 * console.log(parsed.metadata.name);
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('skill-parser');

// ============================================================================
// Types
// ============================================================================

/**
 * Parsed skill metadata from frontmatter
 */
export interface SkillFrontmatter {
  /** Unique skill identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Semantic version */
  version: string;
  /** Brief description */
  description: string;
  /** Author name or organization */
  author: string;
  /** Comma-separated tags */
  tags: string[];
  /** Category (productivity, dev, etc.) */
  category?: string;
  /** Icon emoji or URL */
  icon?: string;
  /** License (MIT, Apache-2.0, etc.) */
  license?: string;
  /** Repository URL */
  repository?: string;
  /** Homepage URL */
  homepage?: string;
}

/**
 * Gating requirements for a skill
 */
export interface SkillGating {
  /** Required binaries on PATH */
  binaries: string[];
  /** At least one of these binaries required */
  anyBinaries: string[];
  /** Required environment variables */
  envVars: string[];
  /** Required config file paths */
  configPaths: string[];
  /** Supported operating systems */
  os: ('darwin' | 'linux' | 'win32')[];
  /** Primary API key environment variable */
  primaryEnv?: string;
}

/**
 * Tool definition from SKILL.md
 */
export interface SkillToolDef {
  /** Tool name */
  name: string;
  /** Tool description */
  description: string;
  /** Parameter definitions as YAML/JSON */
  parameters?: Record<string, SkillToolParam>;
  /** Example usage */
  examples?: string[];
}

/**
 * Tool parameter definition
 */
export interface SkillToolParam {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
}

/**
 * Prompt definition from SKILL.md
 */
export interface SkillPromptDef {
  /** Prompt identifier */
  name: string;
  /** Prompt content */
  content: string;
}

/**
 * Fully parsed SKILL.md content
 */
export interface ParsedSkill {
  /** Frontmatter metadata */
  metadata: SkillFrontmatter;
  /** Gating requirements */
  gating: SkillGating;
  /** Tool definitions */
  tools: SkillToolDef[];
  /** Prompt templates */
  prompts: SkillPromptDef[];
  /** Full documentation text */
  documentation: string;
  /** Raw markdown content */
  rawContent: string;
  /** File path */
  filePath: string;
}

/**
 * Gating check result
 */
export interface GatingCheckResult {
  /** Whether all requirements are met */
  satisfied: boolean;
  /** List of missing requirements */
  missing: {
    type: 'binary' | 'env' | 'config' | 'os';
    name: string;
    description: string;
  }[];
  /** Warnings (non-fatal issues) */
  warnings: string[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default gating structure
 */
const DEFAULT_GATING: SkillGating = {
  binaries: [],
  anyBinaries: [],
  envVars: [],
  configPaths: [],
  os: ['darwin', 'linux', 'win32'],
};

/**
 * Frontmatter delimiter
 */
const FRONTMATTER_DELIMITER = '---';

// ============================================================================
// SkillParser Class
// ============================================================================

/**
 * Parser for SKILL.md files in Clawdbot format.
 *
 * The SKILL.md format consists of:
 * 1. YAML frontmatter with metadata
 * 2. ## Gating section with requirements
 * 3. ## Tools section with tool definitions
 * 4. ## Prompts section with context prompts
 * 5. ## Documentation section with full docs
 *
 * @class SkillParser
 *
 * @example
 * const parser = new SkillParser();
 * const skill = await parser.parseFile('/skills/homebridge/SKILL.md');
 *
 * // Check if requirements are met
 * const check = await parser.checkGating(skill.gating);
 * if (!check.satisfied) {
 *   console.log('Missing:', check.missing);
 * }
 */
export class SkillParser {
  // ==========================================================================
  // Public Methods
  // ==========================================================================

  /**
   * Parse a SKILL.md file from disk.
   *
   * @param filePath - Absolute path to SKILL.md file
   * @returns Parsed skill data
   * @throws Error if file not found or invalid format
   *
   * @example
   * const skill = await parser.parseFile('/path/to/SKILL.md');
   */
  async parseFile(filePath: string): Promise<ParsedSkill> {
    logger.info('Parsing skill file', { filePath });

    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = this.parseContent(content);
    parsed.filePath = filePath;

    logger.info('Skill parsed successfully', {
      id: parsed.metadata.id,
      name: parsed.metadata.name,
      toolCount: parsed.tools.length,
    });

    return parsed;
  }

  /**
   * Parse SKILL.md content string.
   *
   * @param content - Raw markdown content
   * @returns Parsed skill data
   *
   * @example
   * const skill = parser.parseContent(markdownString);
   */
  parseContent(content: string): ParsedSkill {
    const rawContent = content;

    // Extract frontmatter
    const metadata = this._extractFrontmatter(content);

    // Remove frontmatter from content for section parsing
    const bodyContent = this._removeFrontmatter(content);

    // Extract sections
    const gating = this._extractGating(bodyContent);
    const tools = this._extractTools(bodyContent);
    const prompts = this._extractPrompts(bodyContent);
    const documentation = this._extractDocumentation(bodyContent);

    return {
      metadata,
      gating,
      tools,
      prompts,
      documentation,
      rawContent,
      filePath: '',
    };
  }

  /**
   * Check if gating requirements are satisfied.
   *
   * @param gating - Gating requirements to check
   * @returns Check result with missing items
   *
   * @example
   * const result = await parser.checkGating(skill.gating);
   * if (!result.satisfied) {
   *   console.log('Install:', result.missing);
   * }
   */
  async checkGating(gating: SkillGating): Promise<GatingCheckResult> {
    const missing: GatingCheckResult['missing'] = [];
    const warnings: string[] = [];

    // Check OS
    const currentOs = process.platform as 'darwin' | 'linux' | 'win32';
    if (gating.os.length > 0 && !gating.os.includes(currentOs)) {
      missing.push({
        type: 'os',
        name: currentOs,
        description: `Skill requires ${gating.os.join(' or ')}, current OS is ${currentOs}`,
      });
    }

    // Check required binaries
    for (const binary of gating.binaries) {
      const exists = await this._checkBinaryExists(binary);
      if (!exists) {
        missing.push({
          type: 'binary',
          name: binary,
          description: `Required binary '${binary}' not found on PATH`,
        });
      }
    }

    // Check anyBinaries (at least one required)
    if (gating.anyBinaries.length > 0) {
      const anyExists = await Promise.all(
        gating.anyBinaries.map((b) => this._checkBinaryExists(b))
      );
      if (!anyExists.some((e) => e)) {
        missing.push({
          type: 'binary',
          name: gating.anyBinaries.join(' | '),
          description: `At least one of these binaries required: ${gating.anyBinaries.join(', ')}`,
        });
      }
    }

    // Check environment variables
    for (const envVar of gating.envVars) {
      if (!process.env[envVar]) {
        missing.push({
          type: 'env',
          name: envVar,
          description: `Required environment variable '${envVar}' not set`,
        });
      }
    }

    // Check primary env (warn if not set)
    if (gating.primaryEnv && !process.env[gating.primaryEnv]) {
      warnings.push(`Primary API key '${gating.primaryEnv}' not set - some features may not work`);
    }

    // Check config paths
    for (const configPath of gating.configPaths) {
      const expandedPath = this._expandPath(configPath);
      try {
        await fs.access(expandedPath);
      } catch {
        missing.push({
          type: 'config',
          name: configPath,
          description: `Required config file not found: ${configPath}`,
        });
      }
    }

    return {
      satisfied: missing.length === 0,
      missing,
      warnings,
    };
  }

  /**
   * Scan a directory for SKILL.md files.
   *
   * @param dirPath - Directory to scan
   * @param recursive - Whether to scan subdirectories
   * @returns Array of parsed skills
   */
  async scanDirectory(dirPath: string, recursive = true): Promise<ParsedSkill[]> {
    logger.info('Scanning directory for skills', { dirPath, recursive });

    const skills: ParsedSkill[] = [];
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isFile() && entry.name.toUpperCase() === 'SKILL.MD') {
        try {
          const skill = await this.parseFile(fullPath);
          skills.push(skill);
        } catch (error) {
          logger.warn('Failed to parse skill file', { path: fullPath, error });
        }
      } else if (entry.isDirectory() && recursive) {
        const subSkills = await this.scanDirectory(fullPath, recursive);
        skills.push(...subSkills);
      }
    }

    logger.info('Directory scan complete', { dirPath, found: skills.length });
    return skills;
  }

  // ==========================================================================
  // Private Methods - Extraction
  // ==========================================================================

  /**
   * Extract YAML frontmatter from markdown.
   */
  private _extractFrontmatter(content: string): SkillFrontmatter {
    const lines = content.split('\n');
    let inFrontmatter = false;
    const frontmatterLines: string[] = [];

    for (const line of lines) {
      if (line.trim() === FRONTMATTER_DELIMITER) {
        if (inFrontmatter) break;
        inFrontmatter = true;
        continue;
      }
      if (inFrontmatter) {
        frontmatterLines.push(line);
      }
    }

    return this._parseYamlFrontmatter(frontmatterLines.join('\n'));
  }

  /**
   * Remove frontmatter from content.
   */
  private _removeFrontmatter(content: string): string {
    const lines = content.split('\n');
    let delimiterCount = 0;
    let startIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === FRONTMATTER_DELIMITER) {
        delimiterCount++;
        if (delimiterCount === 2) {
          startIndex = i + 1;
          break;
        }
      }
    }

    return lines.slice(startIndex).join('\n');
  }

  /**
   * Parse YAML-like frontmatter (simple parser).
   */
  private _parseYamlFrontmatter(yaml: string): SkillFrontmatter {
    const result: Partial<SkillFrontmatter> = {};
    const lines = yaml.split('\n');

    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        const trimmedValue = value.trim();

        // Handle tags specially (comma-separated to array)
        if (key === 'tags') {
          result.tags = trimmedValue.split(',').map((t) => t.trim());
        } else {
          (result as Record<string, unknown>)[key] = trimmedValue;
        }
      }
    }

    return {
      id: result.id ?? 'unknown',
      name: result.name ?? 'Unknown Skill',
      version: result.version ?? '1.0.0',
      description: result.description ?? '',
      author: result.author ?? 'Unknown',
      tags: result.tags ?? [],
      category: result.category,
      icon: result.icon,
      license: result.license,
      repository: result.repository,
      homepage: result.homepage,
    };
  }

  /**
   * Extract gating section.
   */
  private _extractGating(content: string): SkillGating {
    const gating = { ...DEFAULT_GATING };
    const section = this._extractSection(content, 'Gating');
    if (!section) return gating;

    const lines = section.split('\n');
    for (const line of lines) {
      // Parse bullet points like "- binary: git - Git must be installed"
      const match = line.match(/^-\s*(\w+):\s*([^\s-]+)(?:\s*-\s*(.+))?$/);
      if (match) {
        const [, type, value] = match;

        switch (type.toLowerCase()) {
          case 'binary':
            gating.binaries.push(value);
            break;
          case 'anybinary':
          case 'any-binary':
            gating.anyBinaries.push(value);
            break;
          case 'env':
            gating.envVars.push(value);
            break;
          case 'config':
            gating.configPaths.push(value);
            break;
          case 'os':
            gating.os = value.split(',').map((o) => o.trim()) as typeof gating.os;
            break;
          case 'primaryenv':
          case 'primary-env':
            gating.primaryEnv = value;
            break;
        }
      }
    }

    return gating;
  }

  /**
   * Extract tools section.
   */
  private _extractTools(content: string): SkillToolDef[] {
    const tools: SkillToolDef[] = [];
    const section = this._extractSection(content, 'Tools');
    if (!section) return tools;

    // Split by ### headers for individual tools
    const toolBlocks = section.split(/^###\s+/m).filter((b) => b.trim());

    for (const block of toolBlocks) {
      const lines = block.split('\n');
      const firstLine = lines[0]?.trim();
      if (!firstLine) continue;

      // Tool name is the first line
      const name = firstLine;
      const restLines = lines.slice(1);

      // Find description (first non-empty paragraph)
      let description = '';
      const descLines: string[] = [];
      for (const line of restLines) {
        if (line.trim() === '' && descLines.length > 0) break;
        if (line.trim()) descLines.push(line.trim());
      }
      description = descLines.join(' ');

      tools.push({
        name,
        description,
        parameters: {},
        examples: [],
      });
    }

    return tools;
  }

  /**
   * Extract prompts section.
   */
  private _extractPrompts(content: string): SkillPromptDef[] {
    const prompts: SkillPromptDef[] = [];
    const section = this._extractSection(content, 'Prompts');
    if (!section) return prompts;

    // Split by ### headers for individual prompts
    const promptBlocks = section.split(/^###\s+/m).filter((b) => b.trim());

    for (const block of promptBlocks) {
      const lines = block.split('\n');
      const firstLine = lines[0]?.trim();
      if (!firstLine) continue;

      const name = firstLine;
      const promptContent = lines.slice(1).join('\n').trim();

      prompts.push({ name, content: promptContent });
    }

    return prompts;
  }

  /**
   * Extract documentation section.
   */
  private _extractDocumentation(content: string): string {
    return this._extractSection(content, 'Documentation') ?? '';
  }

  /**
   * Extract a section by header name.
   */
  private _extractSection(content: string, headerName: string): string | null {
    // Match ## headerName or ## headerName (anything)
    const headerPattern = new RegExp(`^##\\s+${headerName}(?:\\s|$)`, 'im');
    const match = content.match(headerPattern);
    if (!match || match.index === undefined) return null;

    const startIndex = match.index + match[0].length;

    // Find the next ## section
    const nextSectionMatch = content.slice(startIndex).match(/^##\s+/m);
    const endIndex = nextSectionMatch?.index
      ? startIndex + nextSectionMatch.index
      : content.length;

    return content.slice(startIndex, endIndex).trim();
  }

  // ==========================================================================
  // Private Methods - Gating Checks
  // ==========================================================================

  /**
   * Check if a binary exists on PATH.
   */
  private async _checkBinaryExists(binary: string): Promise<boolean> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const cmd = process.platform === 'win32' ? `where ${binary}` : `which ${binary}`;

    try {
      await execAsync(cmd);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Expand path with environment variables and ~.
   */
  private _expandPath(p: string): string {
    // Expand ~ to home directory
    if (p.startsWith('~/')) {
      const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
      p = path.join(home, p.slice(2));
    }

    // Expand environment variables like $VAR or ${VAR}
    p = p.replace(/\$(\w+)|\$\{(\w+)\}/g, (_, v1, v2) => {
      return process.env[v1 ?? v2] ?? '';
    });

    return p;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let parserInstance: SkillParser | null = null;

/**
 * Get the singleton skill parser instance.
 */
export function getSkillParser(): SkillParser {
  if (!parserInstance) {
    parserInstance = new SkillParser();
  }
  return parserInstance;
}

export default SkillParser;
