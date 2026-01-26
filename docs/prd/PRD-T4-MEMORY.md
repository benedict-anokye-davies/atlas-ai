# PRD-T4: Memory System

Terminal: T4
Role: Memory System Engineer
Status: NOT_STARTED

## Objective

Implement Atlas's dual-storage memory system:

- Obsidian vault for human-readable, browsable knowledge
- LanceDB for fast vector-based semantic search
- Real-time sync between both systems
- Daily journal generation
- Conversation and context memory

## File Ownership

You own these files exclusively. No other terminal will modify them.

```
src/main/memory/
```

## Architecture

```
                    MEMORY SYSTEM

                         User
                          |
                   [Views/Edits in Obsidian]
                          |
                          v
+--------------------------------------------------+
|                                                  |
|  +-----------------------+    +---------------+  |
|  |    Obsidian Vault     |    |    LanceDB    |  |
|  |  (~/.atlas/brain/)    |<-->|  (Vector DB)  |  |
|  +-----------------------+    +---------------+  |
|  | /people/              |    | notes table   |  |
|  | /concepts/            |    | - id          |  |
|  | /skills/              |    | - path        |  |
|  | /tasks/               |    | - title       |  |
|  | /conversations/       |    | - type        |  |
|  | /research/            |    | - content     |  |
|  | /daily/               |    | - vector[768] |  |
|  | /self/                |    | - updated_at  |  |
|  | /profile/             |    +---------------+  |
|  +-----------------------+                       |
|           ^                                      |
|           |                                      |
|    [File Watcher]                                |
|    (chokidar)                                    |
|                                                  |
+--------------------------------------------------+
                          |
                          v
                    Atlas Main Process
                    (queries memory)
```

## Technology Stack

| Component  | Technology            | Purpose                    |
| ---------- | --------------------- | -------------------------- |
| Vector DB  | LanceDB               | Fast semantic search       |
| Embeddings | nomic-embed-text-v1.5 | 768-dim vectors, Fireworks |
| File Watch | chokidar              | Detect user edits          |
| Markdown   | gray-matter           | YAML frontmatter parsing   |
| File I/O   | fs-extra              | Enhanced file operations   |
| Dates      | date-fns              | Date formatting            |

## Tasks

### Phase 1: Vault Initialization

#### T4-001: Install Memory Dependencies

```bash
npm install @lancedb/lancedb gray-matter chokidar date-fns fs-extra
npm install -D @types/fs-extra
```

After install, run `npx electron-rebuild` to rebuild native modules.

Verification:

```
1. npm install completes without errors
2. npx electron-rebuild succeeds
3. Importing packages works in a test file
```

#### T4-002: Create Vault Directory Structure

File: `src/main/memory/obsidian-brain.ts`

Requirements:

- Create vault at `~/.atlas/brain/`
- Create all subdirectories: people, concepts, skills, tasks, conversations, research, daily, self, profile
- Create `_index.md` MOC (Map of Content) file in each directory
- Handle Windows/macOS/Linux paths correctly

```typescript
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
```

Verification:

```
1. Run initializeVault()
2. Check ~/.atlas/brain/ exists
3. Check all 9 subdirectories exist
4. Check each has _index.md file
```

#### T4-003: Create Obsidian Configuration

File: `src/main/memory/obsidian-brain.ts`

Requirements:

- Create `.obsidian/` folder with config files
- `app.json` - basic app settings
- `appearance.json` - dark theme, readable line width
- `graph.json` - graph view settings

The config should make the vault usable in Obsidian immediately.

Verification:

```
1. Open vault in Obsidian
2. Graph view works
3. Theme is applied
4. No config warnings
```

#### T4-004: Create Initial Template Notes

File: `src/main/memory/templates.ts`

Requirements:

- Create `self/personality.md` with Atlas initial personality
- Create `self/goals.md` with Atlas initial goals
- Create `profile/preferences.md` with empty preferences template
- Create `profile/routines.md` with empty routines template

These are starting points that Atlas will evolve over time.

Verification:

```
1. Check all template notes exist
2. Open in Obsidian and verify formatting
3. Verify frontmatter is valid YAML
```

### Phase 2: Note Management

#### T4-005: Implement Note Creation

File: `src/main/memory/note-writer.ts`

Requirements:

- `createNote(directory, filename, title, content, metadata)` function
- Generate YAML frontmatter from metadata
- Format content with proper markdown
- Handle duplicate filenames (add timestamp suffix)
- Return path to created note

```typescript
interface NoteMetadata {
  type: string;
  [key: string]: any;
}

async function createNote(
  directory: string,
  filename: string,
  title: string,
  content: string,
  metadata: NoteMetadata
): Promise<string>;
```

Verification:

```
1. Create a test note in concepts/
2. Verify file exists with correct content
3. Verify frontmatter is valid YAML
4. Verify title is H1 heading
```

#### T4-006: Implement Note Update

File: `src/main/memory/note-writer.ts`

Requirements:

- `updateNote(notePath, updates)` function
- Preserve existing content not being updated
- Update frontmatter fields
- Append or replace content sections
- Update `last_modified` timestamp

```typescript
async function updateNote(
  notePath: string,
  updates: {
    metadata?: Partial<NoteMetadata>;
    content?: string;
    append?: string;
  }
): Promise<void>;
```

Verification:

```
1. Create a note
2. Update metadata only
3. Verify original content preserved
4. Update content
5. Verify metadata preserved
```

#### T4-007: Implement Backlink Extraction

File: `src/main/memory/backlinks.ts`

Requirements:

- `extractBacklinks(content)` - find all `[[...]]` references
- Handle aliases: `[[Note|Display Text]]`
- Return array of referenced note titles

```typescript
const WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

function extractBacklinks(content: string): string[];
```

Verification:

```
1. Parse "I talked to [[John]] about [[Project X|the project]]"
2. Returns ["John", "Project X"]
```

#### T4-008: Implement Entity Auto-Linking

File: `src/main/memory/backlinks.ts`

Requirements:

- `linkifyText(text, knownEntities)` - add backlinks to known entities
- Case-insensitive matching
- Whole word matching only
- Don't double-link already linked text
- Don't link inside code blocks

```typescript
function linkifyText(text: string, knownEntities: string[]): string;
```

Verification:

```
1. Input: "I met John today" with entities ["John"]
2. Output: "I met [[John]] today"
3. Already linked text stays unchanged
```

### Phase 3: LanceDB Integration

#### T4-009: Initialize LanceDB Database

File: `src/main/memory/lance-db.ts`

Requirements:

- Create database at `~/.atlas/memory.lance`
- Create `notes` table with schema:
  - id: string (file path)
  - path: string
  - title: string
  - type: string
  - content: string
  - vector: float[768]
  - updated_at: string (ISO date)
- Handle table already exists

```typescript
async function initLanceDB(): Promise<void>;
```

Verification:

```
1. Call initLanceDB()
2. Database file exists
3. Table is queryable
4. Second call doesn't error
```

#### T4-010: Implement Embedding Generation

File: `src/main/memory/embeddings.ts`

Requirements:

- Use Fireworks API with nomic-embed-text-v1.5
- `embedText(text)` - single text embedding
- `embedBatch(texts)` - batch embedding (max 32)
- Handle rate limits with retry
- Cache embeddings to avoid re-computing

```typescript
async function embedText(text: string): Promise<number[]>;
async function embedBatch(texts: string[]): Promise<number[][]>;
```

Verification:

```
1. Embed "Hello world"
2. Returns 768-dimensional array
3. Values are floats between -1 and 1
```

#### T4-011: Implement Note Indexing

File: `src/main/memory/lance-sync.ts`

Requirements:

- `indexNote(filePath)` - index single note
- `reindexAll()` - full vault reindex
- Parse frontmatter for metadata
- Extract title from H1
- Generate embedding from title + content
- Upsert into LanceDB

```typescript
async function indexNote(filePath: string): Promise<void>;
async function reindexAll(): Promise<void>;
```

Verification:

```
1. Create a note
2. Index it
3. Search returns the note
4. Update note
5. Reindex
6. Search returns updated content
```

#### T4-012: Implement Semantic Search

File: `src/main/memory/lance-sync.ts`

Requirements:

- `searchNotes(query, options)` - semantic search
- Options: limit, type filter, date range
- Return ranked results with similarity score
- Include note metadata and content excerpt

```typescript
interface SearchOptions {
  limit?: number;
  type?: string;
  since?: Date;
}

interface SearchResult {
  path: string;
  title: string;
  type: string;
  score: number;
  excerpt: string;
}

async function searchNotes(query: string, options?: SearchOptions): Promise<SearchResult[]>;
```

Verification:

```
1. Create notes about different topics
2. Search for topic
3. Most relevant note is first
4. Scores decrease with relevance
```

### Phase 4: File Watcher

#### T4-013: Implement Vault File Watcher

File: `src/main/memory/vault-watcher.ts`

Requirements:

- Watch `~/.atlas/brain/` for changes
- Detect add, change, delete events
- Ignore `.obsidian/` config changes
- Debounce rapid changes (500ms)
- Emit events for each change type

```typescript
function startWatching(): void;
function stopWatching(): void;
```

Verification:

```
1. Start watcher
2. Create file manually
3. Confirm add event fires
4. Edit file
5. Confirm change event fires (debounced)
6. Delete file
7. Confirm delete event fires
```

#### T4-014: Handle User Edits with Reindexing

File: `src/main/memory/vault-watcher.ts`

Requirements:

- On file add: index new note in LanceDB
- On file change: reindex note
- On file delete: remove from LanceDB
- Log all sync operations
- Handle errors without crashing

Verification:

```
1. Open vault in Obsidian
2. Create new note manually
3. Confirm it appears in LanceDB search
4. Edit note in Obsidian
5. Confirm search returns updated content
6. Delete note in Obsidian
7. Confirm search no longer finds it
```

### Phase 5: Daily Journal

#### T4-015: Implement Daily Journal Creation

File: `src/main/memory/daily-journal.ts`

Requirements:

- `createDailyJournal(date?)` - create journal for date
- Default to today if no date
- Filename: `YYYY-MM-DD.md`
- Check if already exists (don't overwrite)
- Include frontmatter with date, day name

```typescript
async function createDailyJournal(date?: Date): Promise<string>;
```

Verification:

```
1. Create journal for today
2. File exists at daily/YYYY-MM-DD.md
3. Call again - doesn't overwrite
4. Create for specific date
```

#### T4-016: Implement Morning Briefing Content

File: `src/main/memory/daily-journal.ts`

Requirements:

- `generateMorningBriefing()` - create briefing section
- Gather data from integrations (calendar, email, portfolio)
- For now, use placeholder/mock data
- Format as markdown sections
- Include: schedule, emails, portfolio, weather

```typescript
async function generateMorningBriefing(): Promise<string>;
```

Verification:

```
1. Generate briefing
2. Returns formatted markdown
3. All sections present
4. Dates are correct
```

#### T4-017: Implement Journal Update Functions

File: `src/main/memory/daily-journal.ts`

Requirements:

- `addTaskToJournal(task, status)` - add task entry
- `addConversationToJournal(summary, link)` - add conversation
- `addReflection(text)` - add to reflections section
- Each appends to appropriate section

```typescript
async function addTaskToJournal(task: string, status: 'done' | 'pending'): Promise<void>;
async function addConversationToJournal(summary: string, noteLink: string): Promise<void>;
async function addReflection(text: string): Promise<void>;
```

Verification:

```
1. Create journal
2. Add task
3. Verify task appears in Tasks section
4. Add conversation
5. Verify it appears in Conversations section
```

### Phase 6: Memory Queries

#### T4-018: Implement getRelatedNotes

File: `src/main/memory/graph-queries.ts`

Requirements:

- Find notes that link to given note title
- Find notes that share common links
- Return array of related note paths
- Sort by relevance (more shared links = more relevant)

```typescript
async function getRelatedNotes(noteTitle: string): Promise<string[]>;
```

Verification:

```
1. Create notes with cross-links
2. Query for related notes
3. Returns notes that link to target
```

#### T4-019: Implement getRecentInteractions

File: `src/main/memory/graph-queries.ts`

Requirements:

- Get recent conversations/tasks involving a person
- Search by person name
- Filter by type (conversation, task, daily)
- Sort by date descending
- Return last N interactions

```typescript
async function getRecentInteractions(personName: string, limit?: number): Promise<any[]>;
```

Verification:

```
1. Create notes mentioning "John"
2. Query interactions with John
3. Returns notes in date order
```

#### T4-020: Implement getKnowledgeAbout

File: `src/main/memory/graph-queries.ts`

Requirements:

- Semantic search for topic
- Combine relevant excerpts
- Format as context for LLM
- Include source citations

```typescript
async function getKnowledgeAbout(topic: string): Promise<string>;
```

Verification:

```
1. Create notes about topic
2. Query knowledge
3. Returns combined context
4. Includes "From [note]:" citations
```

#### T4-021: Implement Conversation Memory

File: `src/main/memory/conversation-memory.ts`

Requirements:

- Store conversation summaries after each interaction
- Create conversation note in conversations/
- Link to daily journal
- Link to mentioned people/concepts
- Include key quotes and action items

```typescript
async function storeConversation(
  summary: string,
  transcript: string,
  entities: string[]
): Promise<string>;

async function getConversationContext(limit?: number): Promise<string>;
```

Verification:

```
1. Store a conversation
2. Note created in conversations/
3. Daily journal updated
4. Entities are linked
5. getConversationContext returns recent conversations
```

### Phase 7: Backup System

#### T4-022: Implement Real-Time Backup

File: `src/main/memory/backup.ts`

Requirements:

- Watch for note changes
- Copy changed files to backup location
- Backup path: `~/.atlas/backups/brain/`
- Incremental (only changed files)
- Timestamp backup folders

```typescript
async function initBackupSystem(): Promise<void>;
async function backupNote(notePath: string): Promise<void>;
```

Verification:

```
1. Create/edit note
2. Backup triggered automatically
3. Backup file exists
4. Content matches original
```

#### T4-023: Implement Backup Rotation

File: `src/main/memory/backup.ts`

Requirements:

- Keep last 7 daily backups
- Create daily snapshot at midnight
- Delete backups older than 7 days
- Full backup includes all notes

```typescript
async function createDailyBackup(): Promise<void>;
async function pruneOldBackups(): Promise<void>;
```

Verification:

```
1. Create daily backup
2. Backup folder created with date
3. After 8 backups, oldest deleted
4. Only 7 remain
```

## IPC Channels

Prefix all channels with `memory:`:

```typescript
// Main -> Renderer
'memory:ready'; // Memory system initialized
'memory:note-created'; // New note created
'memory:note-updated'; // Note was updated
'memory:search-results'; // Search results

// Renderer -> Main (via invoke)
'memory:search'; // Search notes
'memory:get-context'; // Get conversation context
'memory:store-conversation'; // Store conversation
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

## Quality Checklist

Before marking any task DONE:

- [ ] Code compiles without errors
- [ ] No TypeScript warnings
- [ ] Manual test passes
- [ ] Error cases handled
- [ ] Console logs use logger (not console.log)
- [ ] File paths work on Windows

## Performance Targets

| Metric             | Target  |
| ------------------ | ------- |
| Vault init         | < 1s    |
| Note creation      | < 100ms |
| Note indexing      | < 500ms |
| Semantic search    | < 100ms |
| Full reindex       | < 30s   |
| Backup single note | < 50ms  |

## Common Issues

### LanceDB native module errors

Run `npx electron-rebuild` after installing.

### Embedding rate limits

Fireworks has rate limits. Implement exponential backoff.

### File path issues on Windows

Use `path.join()` for all paths. Never hardcode `/` or `\`.

### Chokidar not detecting changes

Increase `awaitWriteFinish.stabilityThreshold` to 1000ms.

## Notes

- All file I/O on main process only
- Use IPC for renderer communication
- Test with both Obsidian open and closed
- Log all operations for debugging
- Handle Obsidian lock files gracefully
