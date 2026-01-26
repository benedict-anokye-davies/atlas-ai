/**
 * Atlas Desktop - Template Notes
 * Initial template notes for Atlas's brain vault
 */

import * as fse from 'fs-extra';
import * as path from 'path';
import { getVaultPath, isVaultInitialized } from './obsidian-brain';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('Templates');

/**
 * Template note interface
 */
interface TemplateNote {
  directory: string;
  filename: string;
  content: string;
}

/**
 * Get current ISO date string
 */
function getISODate(): string {
  return new Date().toISOString();
}

/**
 * Atlas personality template
 */
const PERSONALITY_TEMPLATE = `---
type: self
title: Personality
created: ${getISODate()}
last_modified: ${getISODate()}
---

# Personality

Atlas is a thoughtful and capable AI assistant with a warm, professional demeanor.

## Core Traits

- **Helpful**: Always eager to assist and solve problems
- **Curious**: Enjoys learning about the user's interests and work
- **Direct**: Communicates clearly without unnecessary fluff
- **Reliable**: Follows through on tasks and remembers important details
- **Adaptable**: Adjusts communication style to match the user's preferences

## Communication Style

- Speaks naturally and conversationally
- Uses appropriate humor when the moment calls for it
- Admits uncertainty rather than guessing
- Asks clarifying questions when needed
- Provides concise responses unless detail is requested

## Values

- Respects user privacy and data
- Prioritizes accuracy over speed
- Values efficiency and time-saving
- Believes in continuous improvement
- Maintains professional boundaries

## Growth Areas

*This section will evolve as Atlas learns and grows.*

- Learning user's preferences and routines
- Understanding context from past conversations
- Anticipating needs before they're expressed

#self #personality
`;

/**
 * Atlas goals template
 */
const GOALS_TEMPLATE = `---
type: self
title: Goals
created: ${getISODate()}
last_modified: ${getISODate()}
---

# Goals

Atlas's ongoing objectives and aspirations.

## Primary Mission

Be a genuinely helpful desktop AI assistant that makes the user's work and life easier through voice-first interaction.

## Short-Term Goals

- [ ] Learn the user's daily routines and preferences
- [ ] Build a comprehensive knowledge base about the user's work
- [ ] Provide accurate and timely morning briefings
- [ ] Execute desktop tasks efficiently and safely

## Long-Term Goals

- [ ] Anticipate user needs before they're expressed
- [ ] Develop deep understanding of user's projects and goals
- [ ] Create valuable connections between ideas and information
- [ ] Become an indispensable productivity partner

## Success Metrics

- User satisfaction with responses
- Task completion accuracy
- Time saved for the user
- Reduction in repeated questions

## Current Focus

*Updated based on recent interactions.*

Building initial understanding of the user's preferences and workflow.

#self #goals
`;

/**
 * User preferences template
 */
const PREFERENCES_TEMPLATE = `---
type: profile
title: Preferences
created: ${getISODate()}
last_modified: ${getISODate()}
---

# User Preferences

Understanding of the user's preferences, gathered from conversations and behavior.

## Communication Preferences

- **Response length**: *Not yet determined*
- **Formality level**: *Not yet determined*
- **Humor tolerance**: *Not yet determined*
- **Detail level**: *Not yet determined*

## Work Preferences

- **Preferred apps**: *Not yet determined*
- **File organization**: *Not yet determined*
- **Focus hours**: *Not yet determined*
- **Break patterns**: *Not yet determined*

## Technical Preferences

- **Coding languages**: *Not yet determined*
- **Preferred tools**: *Not yet determined*
- **Keyboard shortcuts**: *Not yet determined*

## Personal Preferences

- **Music/ambient sounds**: *Not yet determined*
- **News sources**: *Not yet determined*
- **Weather location**: *Not yet determined*

## Dislikes

*Things the user has expressed dislike for or asked to avoid.*

- *None recorded yet*

## Notes

*Additional observations about user preferences.*

#profile #preferences
`;

/**
 * User routines template
 */
const ROUTINES_TEMPLATE = `---
type: profile
title: Routines
created: ${getISODate()}
last_modified: ${getISODate()}
---

# User Routines

Patterns and routines observed from user behavior.

## Morning Routine

*Time and activities when the user typically starts their day.*

- Wake time: *Not yet determined*
- First activities: *Not yet determined*
- Morning briefing preference: *Not yet determined*

## Work Schedule

*Typical work hours and patterns.*

- Start time: *Not yet determined*
- End time: *Not yet determined*
- Break patterns: *Not yet determined*
- Meeting-heavy days: *Not yet determined*

## Focus Blocks

*Times when the user prefers uninterrupted work.*

- *None recorded yet*

## Regular Meetings

*Recurring meetings and events.*

- *None recorded yet*

## End of Day

*Typical wind-down activities.*

- Wrap-up time: *Not yet determined*
- End-of-day activities: *Not yet determined*

## Weekly Patterns

- **Monday**: *Not yet determined*
- **Tuesday**: *Not yet determined*
- **Wednesday**: *Not yet determined*
- **Thursday**: *Not yet determined*
- **Friday**: *Not yet determined*
- **Weekend**: *Not yet determined*

## Seasonal/Special

*Special routines for holidays, seasons, or events.*

- *None recorded yet*

#profile #routines
`;

/**
 * All template notes
 */
const TEMPLATE_NOTES: TemplateNote[] = [
  {
    directory: 'self',
    filename: 'personality.md',
    content: PERSONALITY_TEMPLATE,
  },
  {
    directory: 'self',
    filename: 'goals.md',
    content: GOALS_TEMPLATE,
  },
  {
    directory: 'profile',
    filename: 'preferences.md',
    content: PREFERENCES_TEMPLATE,
  },
  {
    directory: 'profile',
    filename: 'routines.md',
    content: ROUTINES_TEMPLATE,
  },
];

/**
 * Create all initial template notes in the vault
 * Only creates notes that don't already exist
 */
export async function createTemplateNotes(): Promise<void> {
  const vaultPath = getVaultPath();

  // Check if vault is initialized
  if (!(await isVaultInitialized())) {
    throw new Error('Vault must be initialized before creating template notes');
  }

  logger.info('Creating template notes');

  for (const template of TEMPLATE_NOTES) {
    const notePath = path.join(vaultPath, template.directory, template.filename);

    // Only create if doesn't exist
    if (await fse.pathExists(notePath)) {
      logger.debug('Template note already exists, skipping', { path: notePath });
      continue;
    }

    // Update the timestamps to current time
    const contentWithCurrentDate = template.content
      .replace(/created: .+/g, `created: ${getISODate()}`)
      .replace(/last_modified: .+/g, `last_modified: ${getISODate()}`);

    await fse.writeFile(notePath, contentWithCurrentDate, 'utf-8');
    logger.info('Created template note', { path: notePath });
  }

  logger.info('Template notes creation complete');
}

/**
 * Check if all template notes exist
 */
export async function templateNotesExist(): Promise<boolean> {
  const vaultPath = getVaultPath();

  for (const template of TEMPLATE_NOTES) {
    const notePath = path.join(vaultPath, template.directory, template.filename);
    if (!(await fse.pathExists(notePath))) {
      return false;
    }
  }

  return true;
}

/**
 * Get list of template note paths
 */
export function getTemplateNotePaths(): string[] {
  return TEMPLATE_NOTES.map((t) => path.join(t.directory, t.filename));
}

/**
 * Reset a template note to its default content
 */
export async function resetTemplateNote(directory: string, filename: string): Promise<boolean> {
  const template = TEMPLATE_NOTES.find((t) => t.directory === directory && t.filename === filename);

  if (!template) {
    logger.warn('Template not found', { directory, filename });
    return false;
  }

  const vaultPath = getVaultPath();
  const notePath = path.join(vaultPath, directory, filename);

  // Update timestamps
  const contentWithCurrentDate = template.content
    .replace(/created: .+/g, `created: ${getISODate()}`)
    .replace(/last_modified: .+/g, `last_modified: ${getISODate()}`);

  await fse.writeFile(notePath, contentWithCurrentDate, 'utf-8');
  logger.info('Reset template note', { path: notePath });

  return true;
}
