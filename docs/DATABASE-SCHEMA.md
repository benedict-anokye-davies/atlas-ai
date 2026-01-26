# Atlas Database Schema

This document defines all data storage schemas for the Atlas AI assistant.

---

## Storage Overview

| Store | Technology | Purpose | Location |
|-------|------------|---------|----------|
| **Vector DB** | LanceDB | Semantic memory, embeddings | `~/.atlas/memory/` |
| **Metadata DB** | SQLite | Structured data, settings | `~/.atlas/atlas.db` |
| **Credentials** | Electron safeStorage | API keys, OAuth tokens | OS Keychain |
| **Config** | JSON | User settings | `~/.atlas/config.json` |
| **Logs** | Files | Application logs | `~/.atlas/logs/` |

---

## LanceDB Tables (Vector Storage)

### Table: `memories`

Stores all semantic memories (conversations, facts, documents).

```typescript
interface MemoryRecord {
  // Primary key
  id: string;                    // UUID

  // Embedding
  vector: Float32Array;          // 1536 dimensions (OpenAI compatible)

  // Content
  content: string;               // Raw text content
  content_type: string;          // 'conversation' | 'fact' | 'preference' | 'document'

  // Metadata
  importance: number;            // 0.0 - 1.0
  timestamp: number;             // Unix timestamp (ms)
  expires_at: number | null;     // Null = permanent

  // Relationships
  conversation_id: string | null;
  message_id: string | null;
  document_id: string | null;

  // Searchable metadata
  topics: string[];              // Extracted topics
  sentiment: string;             // 'positive' | 'negative' | 'neutral'
  source: string;                // 'voice' | 'chat' | 'document' | 'workflow'

  // For hybrid search
  keywords: string[];            // Extracted keywords for BM25
}
```

**Indexes**:
- Vector index on `vector` (HNSW)
- Full-text index on `content` (BM25)
- Index on `timestamp` for recency queries
- Index on `importance` for filtering
- Index on `content_type` for type filtering

**Example Queries**:
```typescript
// Semantic search
const results = await memories.search(queryVector)
  .select(['id', 'content', 'importance', 'timestamp'])
  .where('importance > 0.3')
  .limit(10);

// Hybrid search (vector + keyword)
const results = await memories
  .search(queryVector)
  .where(`content LIKE '%${keyword}%'`)
  .limit(10);

// Recent memories
const results = await memories
  .filter(`timestamp > ${Date.now() - 7 * 24 * 60 * 60 * 1000}`)
  .orderBy('timestamp', 'desc')
  .limit(20);
```

---

### Table: `documents`

Stores document chunks for RAG.

```typescript
interface DocumentChunk {
  id: string;                    // UUID
  vector: Float32Array;          // 1536 dimensions

  // Document info
  document_id: string;           // Parent document ID
  chunk_index: number;           // Order within document

  // Content
  content: string;               // Chunk text
  content_type: string;          // 'text' | 'table' | 'heading' | 'code'

  // Metadata
  filename: string;
  file_path: string;
  file_type: string;             // 'pdf' | 'md' | 'txt' | 'docx'
  page_number: number | null;
  heading: string | null;        // Section heading if available

  // Timestamps
  indexed_at: number;
  file_modified_at: number;
}
```

---

## SQLite Schema

### Table: `settings`

Key-value store for user settings.

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,          -- JSON serialized
  updated_at INTEGER NOT NULL
);

-- Default settings
INSERT INTO settings (key, value, updated_at) VALUES
  ('user.name', '""', 0),
  ('user.isOnboarded', 'false', 0),
  ('voice.wakeWordEnabled', 'true', 0),
  ('voice.wakeWordSensitivity', '0.7', 0),
  ('voice.pushToTalkKey', '"Ctrl+Space"', 0),
  ('voice.speed', '1.0', 0),
  ('personality.friendliness', '0.9', 0),
  ('personality.formality', '0.3', 0),
  ('personality.humor', '0.7', 0),
  ('personality.proactiveness', '0.6', 0),
  ('privacy.memoryEnabled', 'true', 0),
  ('privacy.memoryRetentionDays', '90', 0),
  ('privacy.incognitoMode', 'false', 0),
  ('visual.qualityPreset', '"auto"', 0),
  ('visual.particleCount', '8000', 0),
  ('system.startWithSystem', 'true', 0),
  ('system.startMinimized', 'false', 0);
```

---

### Table: `conversations`

Conversation metadata.

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT,                    -- Auto-generated or user-set
  summary TEXT,                  -- LLM-generated summary
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  message_count INTEGER DEFAULT 0,
  is_archived INTEGER DEFAULT 0,
  metadata TEXT                  -- JSON: topics, sentiment, etc.
);

CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);
CREATE INDEX idx_conversations_archived ON conversations(is_archived);
```

---

### Table: `messages`

Individual conversation messages.

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,            -- 'user' | 'assistant' | 'system' | 'tool'
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,

  -- Tool calls
  tool_calls TEXT,               -- JSON array of tool calls
  tool_results TEXT,             -- JSON array of tool results

  -- Metadata
  model TEXT,                    -- LLM model used
  tokens_input INTEGER,
  tokens_output INTEGER,
  cost REAL,                     -- Cost in USD
  latency_ms INTEGER,            -- Response time

  -- Audio
  audio_duration_ms INTEGER,     -- If voice input

  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, timestamp);
CREATE INDEX idx_messages_timestamp ON messages(timestamp DESC);
```

---

### Table: `user_facts`

Extracted facts about the user.

```sql
CREATE TABLE user_facts (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,        -- 'personal' | 'preference' | 'work' | 'relationship' | 'other'
  key TEXT NOT NULL,             -- e.g., 'favorite_color', 'job_title'
  value TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,   -- 0.0 - 1.0
  source_message_id TEXT,
  is_permanent INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,            -- Null = permanent

  FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX idx_user_facts_category ON user_facts(category);
CREATE INDEX idx_user_facts_key ON user_facts(key);
CREATE UNIQUE INDEX idx_user_facts_unique ON user_facts(category, key);
```

---

### Table: `workflows`

Workflow definitions.

```sql
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  definition TEXT NOT NULL,      -- JSON workflow definition
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_run_at INTEGER,
  next_run_at INTEGER,
  run_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  is_template INTEGER DEFAULT 0,
  template_id TEXT,              -- If created from template

  FOREIGN KEY (template_id) REFERENCES workflows(id)
);

CREATE INDEX idx_workflows_enabled ON workflows(enabled);
CREATE INDEX idx_workflows_next_run ON workflows(next_run_at);
```

---

### Table: `workflow_runs`

Workflow execution history.

```sql
CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL,          -- 'pending' | 'running' | 'success' | 'error' | 'cancelled'
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  duration_ms INTEGER,

  -- Trigger info
  trigger_type TEXT,             -- 'schedule' | 'webhook' | 'event' | 'manual'
  trigger_data TEXT,             -- JSON

  -- Execution details
  actions_completed INTEGER DEFAULT 0,
  actions_total INTEGER,
  current_action TEXT,

  -- Results
  result TEXT,                   -- JSON
  error TEXT,
  error_stack TEXT,

  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);

CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id, started_at DESC);
CREATE INDEX idx_workflow_runs_status ON workflow_runs(status);
```

---

### Table: `integrations`

Connected external services.

```sql
CREATE TABLE integrations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,            -- 'gmail' | 'calendar' | 'discord' | 'crypto' | etc.
  name TEXT NOT NULL,            -- User-friendly name
  config TEXT,                   -- JSON (non-sensitive config)
  status TEXT DEFAULT 'disconnected',  -- 'connected' | 'disconnected' | 'error' | 'expired'
  last_sync_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  -- OAuth-specific
  oauth_provider TEXT,           -- 'google' | 'microsoft' | 'discord'
  oauth_scopes TEXT,             -- JSON array of granted scopes

  -- Metadata
  capabilities TEXT              -- JSON array of available actions
);

CREATE INDEX idx_integrations_type ON integrations(type);
CREATE INDEX idx_integrations_status ON integrations(status);
```

---

### Table: `notifications`

Notification history.

```sql
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,            -- 'workflow' | 'integration' | 'system' | 'reminder'
  source_id TEXT,                -- workflow_id, integration_id, etc.
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  priority TEXT DEFAULT 'normal', -- 'low' | 'normal' | 'high' | 'urgent'
  is_read INTEGER DEFAULT 0,
  is_dismissed INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  data TEXT                      -- JSON additional data
);

CREATE INDEX idx_notifications_unread ON notifications(is_read, created_at DESC);
CREATE INDEX idx_notifications_source ON notifications(type, source_id);
```

---

### Table: `api_usage`

API usage tracking for cost management.

```sql
CREATE TABLE api_usage (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,            -- YYYY-MM-DD
  service TEXT NOT NULL,         -- 'fireworks' | 'deepgram' | 'elevenlabs' | 'openrouter'
  model TEXT,
  requests INTEGER DEFAULT 0,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  audio_seconds INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,

  UNIQUE(date, service, model)
);

CREATE INDEX idx_api_usage_date ON api_usage(date DESC);
CREATE INDEX idx_api_usage_service ON api_usage(service);
```

---

### Table: `tool_permissions`

Remembered tool permission decisions.

```sql
CREATE TABLE tool_permissions (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  action TEXT NOT NULL,
  path_pattern TEXT,             -- For file operations, optional glob pattern
  allowed INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,            -- Null = permanent

  UNIQUE(tool_name, action, path_pattern)
);

CREATE INDEX idx_tool_permissions_tool ON tool_permissions(tool_name, action);
```

---

## Credential Storage (Electron safeStorage)

Credentials are stored securely using OS keychain via Electron's safeStorage API.

```typescript
// Credential keys (stored in keychain)
type CredentialKey =
  | 'fireworks_api_key'
  | 'deepgram_api_key'
  | 'elevenlabs_api_key'
  | 'porcupine_api_key'
  | 'openrouter_api_key'
  | 'google_oauth_token'         // JSON: { access_token, refresh_token, expires_at }
  | 'microsoft_oauth_token'
  | 'discord_bot_token'
  | 'encryption_key';            // For at-rest encryption

// Storage functions
async function storeCredential(key: CredentialKey, value: string): Promise<void>;
async function getCredential(key: CredentialKey): Promise<string | null>;
async function deleteCredential(key: CredentialKey): Promise<void>;
```

---

## Config File Schema

`~/.atlas/config.json` - Non-sensitive configuration.

```typescript
interface AtlasConfig {
  version: string;               // Config schema version

  // Window state (restore on open)
  window: {
    width: number;
    height: number;
    x: number | null;
    y: number | null;
    isMaximized: boolean;
  };

  // Recently used
  recentConversations: string[]; // Last 10 conversation IDs
  recentWorkflows: string[];     // Last 10 workflow IDs

  // Audio devices (by ID)
  audio: {
    inputDeviceId: string | null;
    outputDeviceId: string | null;
  };

  // Feature flags
  features: {
    betaFeatures: boolean;
    developerMode: boolean;
  };

  // Telemetry (if opted in)
  telemetry: {
    enabled: boolean;
    anonymousId: string | null;
  };
}
```

---

## Migration Strategy

### Version Tracking

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
```

### Migration Files

```
src/main/db/migrations/
├── 001_initial_schema.ts
├── 002_add_workflow_runs.ts
├── 003_add_api_usage.ts
└── ...
```

### Migration Template

```typescript
// src/main/db/migrations/001_initial_schema.ts
import { Database } from 'better-sqlite3';

export const version = 1;
export const name = 'initial_schema';

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE settings (...);
    CREATE TABLE conversations (...);
    -- etc.
  `);
}

export function down(db: Database): void {
  db.exec(`
    DROP TABLE settings;
    DROP TABLE conversations;
    -- etc.
  `);
}
```

---

## Data Lifecycle

### Retention Policies

| Data Type | Default Retention | User Override |
|-----------|-------------------|---------------|
| Conversations | 90 days | 30-365 days or permanent |
| Memories | 90 days | 30-365 days or permanent |
| User facts | Permanent | Can be deleted manually |
| Workflow runs | 30 days | 7-90 days |
| Notifications | 7 days | 1-30 days |
| API usage | 1 year | Not configurable |
| Logs | 7 days | 1-30 days |

### Cleanup Jobs

```typescript
// Run daily at 3 AM
async function dailyCleanup(): Promise<void> {
  // 1. Delete expired memories
  await db.run(`
    DELETE FROM memories
    WHERE expires_at IS NOT NULL AND expires_at < ?
  `, [Date.now()]);

  // 2. Delete old workflow runs
  const retentionMs = settings.get('workflow.runRetentionDays') * 24 * 60 * 60 * 1000;
  await db.run(`
    DELETE FROM workflow_runs
    WHERE completed_at < ?
  `, [Date.now() - retentionMs]);

  // 3. Delete old notifications
  await db.run(`
    DELETE FROM notifications
    WHERE created_at < ?
  `, [Date.now() - 7 * 24 * 60 * 60 * 1000]);

  // 4. Vacuum database
  await db.run('VACUUM');

  // 5. Consolidate memories (if enabled)
  if (settings.get('memory.consolidationEnabled')) {
    await memoryService.consolidate();
  }
}
```

---

## Export/Import

### Data Export Format

```typescript
interface AtlasExport {
  version: string;
  exportedAt: number;
  data: {
    settings: Record<string, any>;
    conversations: Conversation[];
    messages: Message[];
    userFacts: UserFact[];
    workflows: Workflow[];
    // Note: Credentials NOT exported
  };
}
```

### Export Function

```typescript
async function exportAllData(): Promise<AtlasExport> {
  return {
    version: '1.0',
    exportedAt: Date.now(),
    data: {
      settings: await db.all('SELECT * FROM settings'),
      conversations: await db.all('SELECT * FROM conversations'),
      messages: await db.all('SELECT * FROM messages'),
      userFacts: await db.all('SELECT * FROM user_facts'),
      workflows: await db.all('SELECT * FROM workflows WHERE is_template = 0'),
    },
  };
}
```

---

**Last Updated**: 2026-01-15
