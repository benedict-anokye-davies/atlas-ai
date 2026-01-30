/**
 * Atlas Desktop - Skills Index
 * Session 043-A: Skill system architecture
 *
 * Export all built-in skills, parser, registry, and utilities.
 */

import type { Skill } from '../../../shared/types/skill';
import { CalculatorSkill } from './calculator-skill';
import { TimerSkill } from './timer-skill';
import { WeatherSkill } from './weather-skill';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('skills-index');

// Export base class and individual skills
export { BaseSkill } from './base-skill';
export { CalculatorSkill } from './calculator-skill';
export { TimerSkill } from './timer-skill';
export { WeatherSkill } from './weather-skill';

// Export skill parser
export {
  SkillParser,
  getSkillParser,
  type ParsedSkill,
  type SkillFrontmatter,
  type SkillGating,
  type SkillToolDef,
  type SkillPromptDef,
  type GatingCheckResult,
} from './skill-parser';

// Export skill registry
export {
  SkillRegistry,
  getSkillRegistry,
  shutdownSkillRegistry,
  type InstalledSkill,
  type SkillSource,
  type RegistryConfig,
} from './skill-registry';

/**
 * Get all built-in skills
 */
export function getBuiltInSkills(): Skill[] {
  logger.info('[Skills] Creating built-in skills');

  return [
    new CalculatorSkill(),
    new TimerSkill(),
    new WeatherSkill(),
    // Add more built-in skills here as they are created:
    // new NotesSkill(),
  ];
}

/**
 * Get a built-in skill by ID
 */
export function getBuiltInSkillById(id: string): Skill | undefined {
  const skills = getBuiltInSkills();
  return skills.find((s) => s.id === id);
}

/**
 * Get built-in skill IDs
 */
export function getBuiltInSkillIds(): string[] {
  return getBuiltInSkills().map((s) => s.id);
}

/**
 * Skill category groupings
 */
export const SKILL_CATEGORIES = {
  productivity: ['calculator', 'timer', 'notes', 'reminders'],
  information: ['weather', 'news', 'search'],
  communication: ['email', 'messaging'],
  development: ['git', 'terminal', 'code'],
  entertainment: ['music', 'media'],
  system: ['settings', 'files', 'apps'],
} as const;

export default getBuiltInSkills;
