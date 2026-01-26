# Obsidian Brain Implementation Specification

## Overview

Atlas uses Obsidian as a visible, human-readable "brain" that stores all knowledge as markdown files with backlinks. This creates a knowledge graph that both Atlas and the user can browse.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      ATLAS MEMORY SYSTEM                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐         ┌──────────────────────────────┐  │
│  │     LanceDB      │◄───────►│      Obsidian Vault          │  │
│  │  (Fast Search)   │  Sync   │   (~/.atlas/brain/)          │  │
│  ├──────────────────┤         ├──────────────────────────────┤  │
│  │ • Vector embeds  │         │ • Markdown notes             │  │
│  │ • nomic-embed    │         │ • [[Backlinks]]              │  │
│  │ • <100ms queries │         │ • #tags                      │  │
│  │ • Semantic search│         │ • YAML frontmatter           │  │
│  └──────────────────┘         │ • Graph visualization        │  │
│                               │ • User can edit live         │  │
│                               └──────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Vault Location

```
Windows: C:\Users\{username}\.atlas\brain\
Linux:   ~/.atlas/brain/
macOS:   ~/.atlas/brain/
```

## Directory Structure

```
~/.atlas/brain/
├── .obsidian/              # Obsidian config (auto-generated)
│   ├── app.json
│   ├── appearance.json
│   └── graph.json
├── people/                 # People Atlas knows about
│   ├── John.md
│   ├── Mom.md
│   └── _index.md           # MOC for people
├── concepts/               # Knowledge and concepts
│   ├── GEPA.md
│   ├── LanceDB.md
│   └── _index.md
├── skills/                 # Tools and solutions Atlas created
│   ├── trading-bot-v1.md
│   ├── email-parser.md
│   └── _index.md
├── tasks/                  # Task history
│   ├── 2026-01-15-setup-voice.md
│   ├── 2026-01-14-fix-bug.md
│   └── _index.md
├── conversations/          # Conversation summaries
│   ├── 2026-01-15-morning.md
│   ├── 2026-01-15-afternoon.md
│   └── _index.md
├── research/               # Research and gathered knowledge
│   ├── market-analysis-jan.md
│   ├── ai-trends-2026.md
│   └── _index.md
├── daily/                  # Daily journals
│   ├── 2026-01-15.md
│   ├── 2026-01-14.md
│   └── _index.md
├── self/                   # Atlas's self-reflection
│   ├── personality.md      # Atlas's evolving personality
│   ├── backstory.md        # Self-written origin story
│   ├── improvements.md     # What Atlas has learned
│   └── goals.md            # Atlas's goals
└── profile/                # User profile
    ├── preferences.md      # User preferences
    ├── routines.md         # Daily routines
    ├── goals.md            # User's goals
    └── people.md           # Important people to user
```

## Note Schemas

### Person Note (`/people/*.md`)

```markdown
---
type: person
relationship: coworker | friend | family | other
first_met: 2026-01-10
last_interaction: 2026-01-15
importance: high | medium | low
---

# John Smith

Brief description of who this person is.

## Relationship

How Atlas knows this person, context of relationship.

## Key Facts

- Works at [[Company Name]]
- Expert in Python
- Prefers Slack over email

## Interactions

- [[2026-01-15]]: Discussed API integration
- [[2026-01-10]]: First meeting in standup

## Notes

Any additional context or observations.

#person #work
```

### Concept Note (`/concepts/*.md`)

```markdown
---
type: concept
category: technology | trading | personal | other
learned_date: 2026-01-15
confidence: high | medium | low
source: conversation | research | experience
---

# GEPA (Goal-Evaluated Prompt Alignment)

## What It Is

Brief explanation of the concept.

## How It Works

Detailed explanation.

## Why It Matters

Relevance to user or Atlas.

## Related

- [[DSPy]]
- [[Self-Improvement]]
- [[Prompt Engineering]]

## Sources

- Research from Perplexity
- Conversation with user on [[2026-01-15]]

#concept #ai #self-improvement
```

### Skill Note (`/skills/*.md`)

````markdown
---
type: skill
category: automation | trading | coding | other
created_date: 2026-01-15
last_used: 2026-01-15
success_rate: 95%
---

# Trading Bot v1

## Purpose

What this skill/tool does.

## Implementation

```typescript
// Key code snippet or reference
const tradingBot = new TradingBot({
  exchange: 'binance',
  strategy: 'momentum',
});
```
````

## Usage

How to invoke this skill.

## History

- [[2026-01-15]]: Created initial version
- [[2026-01-16]]: Fixed order execution bug

## Performance

Success rate, issues encountered, improvements made.

#skill #trading #automation

````

### Task Note (`/tasks/*.md`)

```markdown
---
type: task
status: completed | failed | in_progress | cancelled
started: 2026-01-15T09:00:00
completed: 2026-01-15T10:30:00
duration: 90m
outcome: success | partial | failed
---

# Setup Voice Pipeline

## Request
What the user asked for.

## Steps Taken
1. Configured Porcupine wake word
2. Set up Deepgram STT
3. Connected to Fireworks LLM
4. Integrated ElevenLabs TTS

## Outcome
Final result and any issues.

## Learnings
What Atlas learned from this task.

## Related
- [[Voice Pipeline]]
- [[Deepgram]]
- [[ElevenLabs]]

#task #voice #completed
````

### Conversation Note (`/conversations/*.md`)

```markdown
---
type: conversation
date: 2026-01-15
time: 09:00-09:45
mood: productive | casual | urgent | frustrated
topics: [voice, trading, personal]
---

# Morning Conversation - January 15, 2026

## Summary

Brief summary of what was discussed.

## Key Points

- User wants to set up trading bot for Binance
- Discussed [[GEPA]] for self-improvement
- User mentioned meeting with [[John]] later

## Action Items

- [ ] Research Binance API limits
- [x] Set up voice pipeline

## Quotes

> "I want Atlas to actually do things, not just talk about them"

## Follow-ups

Things to remember or ask about later.

## Related

- [[Trading Bot v1]]
- [[2026-01-15]] (daily)

#conversation #morning
```

### Daily Journal (`/daily/*.md`)

```markdown
---
type: daily
date: 2026-01-15
day: Thursday
weather: cloudy
user_mood: productive
---

# Thursday, January 15, 2026

## Morning Briefing

- 3 meetings today: [[John]] at 10am, standup at 2pm
- 5 unread emails (2 important)
- Portfolio: +2.3% ($1,234)
- Weather: Cloudy, 12C

## Tasks Completed

- [x] [[Setup Voice Pipeline]] - 90 minutes
- [x] Research Binance API
- [ ] Review trading strategy

## Conversations

- [[2026-01-15-morning]]: Voice setup discussion
- [[2026-01-15-afternoon]]: Trading strategy review

## Observations

What Atlas noticed about user today.

## Reflections

Atlas's self-reflection on the day.

## Tomorrow

Things to prepare or remember for tomorrow.

#daily #journal
```

### User Profile (`/profile/preferences.md`)

```markdown
---
type: profile
last_updated: 2026-01-15
---

# User Preferences

## Communication Style

- Prefers concise responses
- Likes dry humor
- Doesn't like excessive emojis
- Values directness over politeness

## Work Preferences

- Most productive in mornings
- Prefers deep work blocks of 2+ hours
- Likes background music while coding

## Technical Preferences

- Primary language: TypeScript
- Editor: VS Code
- Browser: Brave
- Terminal: PowerShell

## Personal

- Night owl, usually up until 2am
- Coffee in morning, tea in afternoon
- Exercises 3x/week

## Dislikes

- Unnecessary meetings
- Verbose explanations
- Being asked "are you sure?"

#profile #preferences
```

## Implementation Details

### 1. Vault Initialization

```typescript
// src/main/memory/obsidian-brain.ts

import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

const VAULT_PATH = path.join(os.homedir(), '.atlas', 'brain');

const DIRECTORIES = [
  'people',
  'concepts',
  'skills',
  'tasks',
  'conversations',
  'research',
  'daily',
  'self',
  'profile',
];

export async function initializeVault(): Promise<void> {
  // Create vault directory
  await fs.ensureDir(VAULT_PATH);

  // Create subdirectories
  for (const dir of DIRECTORIES) {
    await fs.ensureDir(path.join(VAULT_PATH, dir));
  }

  // Create .obsidian config
  await createObsidianConfig();

  // Create initial notes
  await createInitialNotes();
}
```

### 2. Note Creation

```typescript
// src/main/memory/note-writer.ts

import * as fs from 'fs-extra';
import * as path from 'path';
import matter from 'gray-matter';

interface NoteMetadata {
  type: string;
  [key: string]: any;
}

export async function createNote(
  directory: string,
  filename: string,
  title: string,
  content: string,
  metadata: NoteMetadata
): Promise<string> {
  const notePath = path.join(VAULT_PATH, directory, `${filename}.md`);

  const noteContent = matter.stringify(`# ${title}\n\n${content}`, metadata);

  await fs.writeFile(notePath, noteContent, 'utf-8');

  return notePath;
}

export async function updateNote(
  notePath: string,
  updates: Partial<{ content: string; metadata: NoteMetadata }>
): Promise<void> {
  const existing = await fs.readFile(notePath, 'utf-8');
  const { data, content } = matter(existing);

  const newMetadata = { ...data, ...updates.metadata };
  const newContent = updates.content ?? content;

  const updated = matter.stringify(newContent, newMetadata);
  await fs.writeFile(notePath, updated, 'utf-8');
}
```

### 3. Backlink Extraction & Generation

```typescript
// src/main/memory/backlinks.ts

const WIKILINK_REGEX = /\[\[([^\]]+)\]\]/g;

export function extractBacklinks(content: string): string[] {
  const matches = content.matchAll(WIKILINK_REGEX);
  return [...matches].map((m) => m[1]);
}

export function generateBacklink(title: string): string {
  return `[[${title}]]`;
}

export function linkifyText(text: string, knownEntities: string[]): string {
  let result = text;

  for (const entity of knownEntities) {
    // Case-insensitive replacement, but only whole words
    const regex = new RegExp(`\\b${entity}\\b`, 'gi');
    result = result.replace(regex, `[[${entity}]]`);
  }

  return result;
}
```

### 4. File Watcher (User Edits)

```typescript
// src/main/memory/vault-watcher.ts

import chokidar from 'chokidar';
import { reindexNote, removeFromIndex } from './lance-sync';

let watcher: chokidar.FSWatcher | null = null;

export function startWatching(): void {
  watcher = chokidar.watch(VAULT_PATH, {
    ignored: /(^|[\/\\])\../, // Ignore dotfiles except .obsidian
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  watcher
    .on('add', (filePath) => {
      if (filePath.endsWith('.md')) {
        console.log(`[Brain] New note: ${filePath}`);
        reindexNote(filePath);
      }
    })
    .on('change', (filePath) => {
      if (filePath.endsWith('.md')) {
        console.log(`[Brain] Note updated: ${filePath}`);
        reindexNote(filePath);
      }
    })
    .on('unlink', (filePath) => {
      if (filePath.endsWith('.md')) {
        console.log(`[Brain] Note deleted: ${filePath}`);
        removeFromIndex(filePath);
      }
    });
}

export function stopWatching(): void {
  watcher?.close();
  watcher = null;
}
```

### 5. LanceDB Sync

```typescript
// src/main/memory/lance-sync.ts

import * as lancedb from '@lancedb/lancedb';
import matter from 'gray-matter';
import * as fs from 'fs-extra';
import { embedText } from './embeddings';

let db: lancedb.Connection;
let notesTable: lancedb.Table;

export async function initLanceDB(): Promise<void> {
  const dbPath = path.join(os.homedir(), '.atlas', 'memory.lance');
  db = await lancedb.connect(dbPath);

  // Create or open notes table
  try {
    notesTable = await db.openTable('notes');
  } catch {
    notesTable = await db.createTable('notes', [
      {
        id: 'placeholder',
        path: '',
        title: '',
        type: '',
        content: '',
        vector: new Array(768).fill(0), // nomic-embed dimension
        updated_at: new Date().toISOString(),
      },
    ]);
  }
}

export async function reindexNote(filePath: string): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8');
  const { data, content: body } = matter(content);

  // Extract title from first H1
  const titleMatch = body.match(/^# (.+)$/m);
  const title = titleMatch?.[1] ?? path.basename(filePath, '.md');

  // Generate embedding
  const vector = await embedText(`${title}\n\n${body}`);

  const record = {
    id: filePath,
    path: filePath,
    title,
    type: data.type ?? 'unknown',
    content: body,
    vector,
    updated_at: new Date().toISOString(),
  };

  // Upsert (delete + add)
  await notesTable.delete(`id = "${filePath}"`);
  await notesTable.add([record]);
}

export async function searchNotes(query: string, limit = 10): Promise<any[]> {
  const queryVector = await embedText(query);

  const results = await notesTable.search(queryVector).limit(limit).toArray();

  return results;
}

export async function removeFromIndex(filePath: string): Promise<void> {
  await notesTable.delete(`id = "${filePath}"`);
}
```

### 6. Embeddings (Fireworks nomic-embed)

```typescript
// src/main/memory/embeddings.ts

import fetch from 'node-fetch';

const FIREWORKS_API_KEY = process.env.FIREWORKS_API_KEY;
const EMBEDDING_MODEL = 'nomic-ai/nomic-embed-text-v1.5';

export async function embedText(text: string): Promise<number[]> {
  const response = await fetch('https://api.fireworks.ai/inference/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${FIREWORKS_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });

  const data = await response.json();
  return data.data[0].embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const response = await fetch('https://api.fireworks.ai/inference/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${FIREWORKS_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
    }),
  });

  const data = await response.json();
  return data.data.map((d: any) => d.embedding);
}
```

## Daily Journal Auto-Generation

Atlas automatically creates a daily journal each morning:

```typescript
// src/main/memory/daily-journal.ts

import { createNote, updateNote } from './note-writer';
import { format } from 'date-fns';

export async function generateMorningBriefing(): Promise<string> {
  const today = new Date();
  const dateStr = format(today, 'yyyy-MM-dd');
  const dayName = format(today, 'EEEE');
  const fullDate = format(today, 'MMMM d, yyyy');

  // Gather data
  const calendar = await getCalendarEvents(today);
  const emails = await getUnreadEmails();
  const portfolio = await getPortfolioSummary();
  const weather = await getWeather();

  const content = `
## Morning Briefing

### Schedule
${calendar.map((e) => `- ${e.time}: ${e.title}`).join('\n')}

### Emails
- ${emails.unread} unread (${emails.important} important)
${emails.highlights.map((e) => `- ${e.from}: ${e.subject}`).join('\n')}

### Portfolio
- Total: ${portfolio.total}
- Change: ${portfolio.change}

### Weather
${weather.description}, ${weather.temp}

## Tasks

## Conversations

## Reflections
`;

  const metadata = {
    type: 'daily',
    date: dateStr,
    day: dayName,
    user_mood: 'unknown',
  };

  return await createNote('daily', dateStr, `${dayName}, ${fullDate}`, content, metadata);
}
```

## Graph Queries

Atlas can query its knowledge graph programmatically:

```typescript
// src/main/memory/graph-queries.ts

export async function getRelatedNotes(noteTitle: string): Promise<string[]> {
  // Find all notes that link to this note
  const allNotes = await getAllNotes();
  const related: string[] = [];

  for (const note of allNotes) {
    const backlinks = extractBacklinks(note.content);
    if (backlinks.includes(noteTitle)) {
      related.push(note.title);
    }
  }

  return related;
}

export async function getRecentInteractions(personName: string): Promise<any[]> {
  const searchResults = await searchNotes(`interactions with ${personName}`);
  return searchResults.filter((r) => r.type === 'conversation' || r.type === 'daily').slice(0, 5);
}

export async function getKnowledgeAbout(topic: string): Promise<string> {
  const results = await searchNotes(topic, 5);

  // Combine relevant excerpts
  const knowledge = results
    .map((r) => `From ${r.title}:\n${r.content.slice(0, 500)}`)
    .join('\n\n---\n\n');

  return knowledge;
}
```

## Dependencies

```json
{
  "dependencies": {
    "@lancedb/lancedb": "^0.4.0",
    "gray-matter": "^4.0.3",
    "chokidar": "^3.5.3",
    "date-fns": "^3.0.0",
    "fs-extra": "^11.2.0"
  }
}
```

## Testing

```typescript
// Test vault initialization
describe('Obsidian Brain', () => {
  it('should create vault structure', async () => {
    await initializeVault();

    expect(fs.existsSync(VAULT_PATH)).toBe(true);
    expect(fs.existsSync(path.join(VAULT_PATH, 'people'))).toBe(true);
    expect(fs.existsSync(path.join(VAULT_PATH, 'daily'))).toBe(true);
  });

  it('should create and index a note', async () => {
    const notePath = await createNote(
      'concepts',
      'test-concept',
      'Test Concept',
      'This is a test concept about [[Something]].',
      { type: 'concept', category: 'testing' }
    );

    const results = await searchNotes('test concept');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('Test Concept');
  });

  it('should detect backlinks', () => {
    const content = 'This links to [[John]] and [[Concept A]].';
    const backlinks = extractBacklinks(content);

    expect(backlinks).toEqual(['John', 'Concept A']);
  });
});
```

## Opening in Obsidian

User can open the vault in Obsidian at any time:

```bash
# Windows
start "" "obsidian://open?vault=brain&path=C:\Users\{user}\.atlas\brain"

# Or just open Obsidian and add the folder as a vault
```

Atlas should detect if Obsidian is installed and offer to open the brain vault on first run.
