# Atlas API Contracts

This document defines the interfaces between the 4 terminal workstreams. Each terminal MUST implement these interfaces for cross-terminal communication.

---

## IPC Channels (Main ↔ Renderer)

All communication between main process and renderer uses these typed channels.

### Voice Events (T1-CORE → T3-ORB)

```typescript
// src/shared/types/ipc.ts

// Wake word detected
interface WakeDetectedEvent {
  channel: 'atlas:wake-detected';
  payload: {
    confidence: number;
    timestamp: number;
    wakeWord: string; // "hey atlas", "computer", etc.
  };
}

// Listening state changed
interface ListeningStateEvent {
  channel: 'atlas:listening-state';
  payload: {
    state: 'idle' | 'listening' | 'hearing' | 'still_listening' | 'processing';
    transcript?: string; // Partial transcript while hearing
  };
}

// Transcript update (STT)
interface TranscriptEvent {
  channel: 'atlas:transcript';
  payload: {
    text: string;
    isFinal: boolean;
    confidence?: number;
  };
}

// Response streaming (LLM)
interface ResponseStartEvent {
  channel: 'atlas:response-start';
  payload: {
    messageId: string;
  };
}

interface ResponseChunkEvent {
  channel: 'atlas:response-chunk';
  payload: {
    messageId: string;
    text: string;
    toolCall?: ToolCall;
  };
}

interface ResponseEndEvent {
  channel: 'atlas:response-end';
  payload: {
    messageId: string;
    fullText: string;
    tokensUsed: number;
    cost: number;
  };
}

// TTS audio (for orb visualization)
interface TTSAudioEvent {
  channel: 'atlas:tts-audio';
  payload: {
    dataUrl: string; // base64 audio
    duration?: number;
  };
}

// Speaking state
interface SpeakingStateEvent {
  channel: 'atlas:speaking-state';
  payload: {
    isSpeaking: boolean;
    text?: string; // What's being spoken
  };
}
```

### Workflow Events (T2-FLOW → T3-ORB)

```typescript
// Workflow status update
interface WorkflowStatusEvent {
  channel: 'atlas:workflow-status';
  payload: {
    workflowId: string;
    status: 'running' | 'success' | 'error' | 'paused';
    lastRun?: number;
    error?: string;
  };
}

// Workflow alert (notifications)
interface WorkflowAlertEvent {
  channel: 'atlas:workflow-alert';
  payload: {
    workflowId: string;
    alertType: 'info' | 'warning' | 'error' | 'success';
    title: string;
    message: string;
    data?: any;
    actions?: AlertAction[];
  };
}

interface AlertAction {
  label: string;
  action: string; // IPC channel to invoke
  payload?: any;
}

// Integration status
interface IntegrationStatusEvent {
  channel: 'atlas:integration-status';
  payload: {
    integrationId: string;
    type: string; // 'gmail', 'calendar', etc.
    status: 'connected' | 'disconnected' | 'error' | 'syncing';
    lastSync?: number;
    error?: string;
  };
}
```

### Tool Events (T4-TOOLS → T3-ORB)

```typescript
// Tool confirmation request
interface ToolConfirmationEvent {
  channel: 'atlas:tool-confirmation';
  payload: {
    requestId: string;
    tool: string;
    action: string;
    description: string;
    dangerLevel: 'safe' | 'moderate' | 'dangerous';
    details?: Record<string, any>;
  };
}

// Tool confirmation response (renderer → main)
interface ToolConfirmationResponse {
  channel: 'atlas:tool-confirmation-response';
  payload: {
    requestId: string;
    approved: boolean;
    remember?: boolean; // Remember this decision
  };
}

// Tool execution progress
interface ToolProgressEvent {
  channel: 'atlas:tool-progress';
  payload: {
    toolId: string;
    progress: number; // 0-100
    status: string;
  };
}
```

### System Events (ALL)

```typescript
// Online/offline status
interface OnlineStatusEvent {
  channel: 'atlas:online-status';
  payload: {
    isOnline: boolean;
    lastCheck: number;
  };
}

// Service health
interface ServiceStatusEvent {
  channel: 'atlas:service-status';
  payload: {
    service: 'stt' | 'tts' | 'llm' | 'memory' | 'workflow';
    status: 'healthy' | 'degraded' | 'offline';
    provider?: string; // Current provider in use
    latency?: number;
  };
}

// Error notification
interface ErrorNotificationEvent {
  channel: 'atlas:error';
  payload: {
    code: string;
    message: string;
    userMessage: string;
    recoverable: boolean;
    action?: string; // Suggested action
  };
}
```

---

## Service Interfaces

These TypeScript interfaces define how terminals communicate within the main process.

### Voice Service (T1-CORE exports)

```typescript
// src/main/voice/types.ts

export interface VoiceService {
  // Lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // Wake word
  startWakeWordDetection(): Promise<void>;
  stopWakeWordDetection(): void;
  setWakeWordSensitivity(sensitivity: number): void;

  // Listening
  startListening(): Promise<void>;
  stopListening(): void;

  // TTS
  speak(text: string, options?: SpeakOptions): Promise<void>;
  stopSpeaking(): void;
  isSpeaking(): boolean;

  // Events
  on(event: 'wake', callback: (data: WakeEvent) => void): void;
  on(event: 'transcript', callback: (data: TranscriptEvent) => void): void;
  on(event: 'speaking', callback: (data: SpeakingEvent) => void): void;
  on(event: 'error', callback: (error: Error) => void): void;
}

export interface SpeakOptions {
  voice?: string;
  speed?: number;
  interruptible?: boolean;
}
```

### LLM Service (T1-CORE exports)

```typescript
// src/main/llm/types.ts

export interface LLMService {
  // Chat
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
  chatStream(messages: Message[], options?: ChatOptions): AsyncIterable<StreamChunk>;

  // Tools
  callTool(toolName: string, args: Record<string, any>): Promise<ToolResult>;
  getAvailableTools(): ToolDefinition[];

  // Memory context
  getContextForQuery(query: string): Promise<ContextData>;

  // Cost
  getUsageToday(): UsageStats;
  getRemainingBudget(): number;
}

export interface ChatOptions {
  model?: string; // Override default model
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  includeMemory?: boolean;
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  model: string;
  tokensUsed: { input: number; output: number };
  cost: number;
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'done';
  content?: string;
  toolCall?: ToolCall;
}
```

### Memory Service (T1-CORE exports)

```typescript
// src/main/memory/types.ts

export interface MemoryService {
  // Storage
  storeConversation(turn: ConversationTurn): Promise<void>;
  storeFact(fact: UserFact): Promise<void>;
  storeDocument(doc: Document): Promise<void>;

  // Retrieval
  searchMemories(query: string, options?: SearchOptions): Promise<Memory[]>;
  getFacts(category?: string): Promise<UserFact[]>;
  getRecentConversations(limit?: number): Promise<ConversationTurn[]>;

  // Context building
  buildContext(query: string): Promise<string>;

  // Management
  forgetMemory(memoryId: string): Promise<void>;
  setRetention(memoryId: string, permanent: boolean): Promise<void>;
  consolidate(): Promise<void>; // Nightly consolidation

  // Incognito
  setIncognitoMode(enabled: boolean): void;
  isIncognitoMode(): boolean;
}

export interface Memory {
  id: string;
  type: 'conversation' | 'fact' | 'document';
  content: string;
  importance: number;
  timestamp: number;
  metadata: Record<string, any>;
}

export interface SearchOptions {
  limit?: number;
  minImportance?: number;
  type?: Memory['type'];
  dateRange?: { start: number; end: number };
}
```

### Workflow Service (T2-FLOW exports)

```typescript
// src/main/workflow/types.ts

export interface WorkflowService {
  // Registration
  registerWorkflow(workflow: Workflow): Promise<void>;
  unregisterWorkflow(workflowId: string): Promise<void>;
  updateWorkflow(workflowId: string, updates: Partial<Workflow>): Promise<void>;

  // Execution
  executeWorkflow(workflowId: string, triggerData?: any): Promise<WorkflowResult>;
  pauseWorkflow(workflowId: string): void;
  resumeWorkflow(workflowId: string): void;
  pauseAll(): void;
  resumeAll(): void;

  // Status
  getWorkflowStatus(workflowId: string): WorkflowStatus;
  getAllWorkflows(): Workflow[];
  getActiveWorkflows(): Workflow[];
  getWorkflowHistory(workflowId: string, limit?: number): WorkflowRun[];

  // Templates
  getTemplates(): WorkflowTemplate[];
  createFromTemplate(templateId: string, config: any): Promise<Workflow>;

  // Voice creation
  createFromDescription(description: string): Promise<Workflow>;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: Trigger;
  conditions?: Condition[];
  actions: Action[];
  errorHandling: ErrorConfig;
}

export interface WorkflowStatus {
  workflowId: string;
  status: 'idle' | 'running' | 'paused' | 'error';
  lastRun?: number;
  nextRun?: number;
  runCount: number;
  errorCount: number;
  lastError?: string;
}
```

### Integration Service (T2-FLOW exports)

```typescript
// src/main/integrations/types.ts

export interface IntegrationService {
  // Registration
  registerIntegration(integration: Integration): Promise<void>;
  unregisterIntegration(integrationId: string): Promise<void>;

  // OAuth
  initiateOAuth(integrationType: string): Promise<string>; // Returns auth URL
  handleOAuthCallback(code: string, state: string): Promise<void>;

  // Status
  getIntegrationStatus(integrationId: string): IntegrationStatus;
  getAllIntegrations(): Integration[];

  // Actions
  executeIntegrationAction(integrationId: string, action: string, params: any): Promise<any>;

  // Specific integrations (convenience methods)
  gmail?: GmailIntegration;
  calendar?: CalendarIntegration;
  discord?: DiscordIntegration;
  crypto?: CryptoIntegration;
}

export interface Integration {
  id: string;
  type: string;
  name: string;
  config: Record<string, any>;
  status: 'connected' | 'disconnected' | 'error';
  capabilities: string[];
}

export interface GmailIntegration {
  getEmails(options?: EmailQuery): Promise<Email[]>;
  sendEmail(to: string, subject: string, body: string): Promise<void>;
  searchEmails(query: string): Promise<Email[]>;
}

export interface CalendarIntegration {
  getEvents(dateRange: DateRange): Promise<CalendarEvent[]>;
  createEvent(event: NewEvent): Promise<CalendarEvent>;
  updateEvent(eventId: string, updates: Partial<NewEvent>): Promise<CalendarEvent>;
}

export interface CryptoIntegration {
  getPrice(symbol: string): Promise<number>;
  subscribeToPriceUpdates(symbol: string, callback: (price: number) => void): () => void;
  getPriceHistory(symbol: string, period: string): Promise<PricePoint[]>;
}
```

### Tool Service (T4-TOOLS exports)

```typescript
// src/main/agent/types.ts

export interface ToolService {
  // Registration
  registerTool(tool: Tool): void;
  unregisterTool(toolName: string): void;

  // Execution
  executeTool(toolName: string, args: Record<string, any>): Promise<ToolResult>;

  // Discovery
  getAvailableTools(): ToolDefinition[];
  getToolDefinition(toolName: string): ToolDefinition | null;

  // Permissions
  checkPermission(toolName: string, action: string): boolean;
  requestPermission(toolName: string, action: string): Promise<boolean>;
  setRememberPermission(toolName: string, action: string, allow: boolean): void;
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute: (args: Record<string, any>) => Promise<any>;
  permissions?: ToolPermission[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ParameterSchema>;
    required?: string[];
  };
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  output?: string; // Human-readable output
}

// Built-in tools
export interface FileSystemTool {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  search(pattern: string, directory?: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  delete(path: string): Promise<void>;
}

export interface TerminalTool {
  execute(command: string, options?: ExecuteOptions): Promise<ExecuteResult>;
  executeStream(command: string): AsyncIterable<string>;
}

export interface BrowserTool {
  navigate(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  screenshot(): Promise<Buffer>;
  getContent(): Promise<string>;
  evaluate(script: string): Promise<any>;
}

export interface GitTool {
  status(): Promise<GitStatus>;
  add(files: string[]): Promise<void>;
  commit(message: string): Promise<void>;
  push(): Promise<void>;
  pull(): Promise<void>;
  checkout(branch: string): Promise<void>;
  createBranch(name: string): Promise<void>;
  diff(files?: string[]): Promise<string>;
  log(limit?: number): Promise<GitCommit[]>;
}
```

---

## Renderer Stores (T3-ORB owns, others read)

```typescript
// src/renderer/stores/atlasStore.ts

export interface AtlasState {
  // Voice state
  voice: {
    state: 'idle' | 'listening' | 'hearing' | 'processing' | 'speaking';
    transcript: string;
    isSpeaking: boolean;
    currentResponse: string;
  };

  // Orb state
  orb: {
    state: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error' | 'working';
    audioLevel: number;
    fftData: Float32Array | null;
  };

  // Panels
  panels: {
    leftOpen: boolean;
    rightOpen: boolean;
    rightContent: 'workflows' | 'integrations' | 'settings';
  };

  // Workflows
  workflows: {
    active: WorkflowStatus[];
    totalCount: number;
    runningCount: number;
  };

  // Integrations
  integrations: {
    connected: Integration[];
    pending: Integration[];
  };

  // User
  user: {
    name: string;
    isOnboarded: boolean;
    incognitoMode: boolean;
  };

  // System
  system: {
    isOnline: boolean;
    services: Record<string, 'healthy' | 'degraded' | 'offline'>;
  };
}

// Actions
export interface AtlasActions {
  setVoiceState(state: AtlasState['voice']['state']): void;
  setTranscript(text: string): void;
  appendResponse(chunk: string): void;
  setOrbState(state: AtlasState['orb']['state']): void;
  setAudioData(level: number, fftData: Float32Array): void;
  togglePanel(panel: 'left' | 'right'): void;
  setRightContent(content: AtlasState['panels']['rightContent']): void;
  updateWorkflowStatus(status: WorkflowStatus): void;
  updateIntegrationStatus(status: Integration): void;
  setOnlineStatus(isOnline: boolean): void;
  setServiceStatus(service: string, status: 'healthy' | 'degraded' | 'offline'): void;
}
```

---

## Event Flow Examples

### Voice Conversation Flow

```
1. User says "Hey Atlas"
   T1-CORE → IPC 'atlas:wake-detected'
   T3-ORB: Updates orb state to 'listening'

2. User speaks query
   T1-CORE → IPC 'atlas:transcript' (interim)
   T3-ORB: Shows transcript in UI
   T1-CORE → IPC 'atlas:transcript' (final)

3. Processing
   T1-CORE → IPC 'atlas:listening-state' { state: 'processing' }
   T3-ORB: Updates orb state to 'thinking'

4. LLM streaming response
   T1-CORE → IPC 'atlas:response-start'
   T1-CORE → IPC 'atlas:response-chunk' (multiple)
   T1-CORE → IPC 'atlas:response-end'

5. TTS playback
   T1-CORE → IPC 'atlas:speaking-state' { isSpeaking: true }
   T1-CORE → IPC 'atlas:tts-audio' (for visualization)
   T3-ORB: Updates orb state to 'speaking', shows audio reactivity

6. Complete
   T1-CORE → IPC 'atlas:speaking-state' { isSpeaking: false }
   T3-ORB: Returns orb to 'idle'
```

### Workflow Trigger Flow

```
1. Workflow trigger fires (e.g., price alert)
   T2-FLOW: Workflow engine detects trigger

2. Execute actions
   T2-FLOW: Runs workflow actions
   T2-FLOW → IPC 'atlas:workflow-status' { status: 'running' }

3. Generate notification
   T2-FLOW → IPC 'atlas:workflow-alert' { title, message }
   T3-ORB: Shows toast notification

4. Optional TTS
   T2-FLOW → T1-CORE: voiceService.speak("Bitcoin dropped below...")
   T1-CORE → IPC 'atlas:speaking-state' { isSpeaking: true }

5. Complete
   T2-FLOW → IPC 'atlas:workflow-status' { status: 'success' }
```

### Tool Execution Flow

```
1. LLM decides to call tool
   T1-CORE → T4-TOOLS: toolService.executeTool('filesystem', { action: 'read', path: '...' })

2. Permission check (if needed)
   T4-TOOLS → IPC 'atlas:tool-confirmation' { tool, action, dangerLevel }
   T3-ORB: Shows confirmation dialog
   User clicks "Allow"
   T3-ORB → IPC 'atlas:tool-confirmation-response' { approved: true }

3. Execute tool
   T4-TOOLS: Executes tool
   T4-TOOLS → T1-CORE: Returns result

4. Continue response
   T1-CORE: Includes tool result in LLM context
   T1-CORE → IPC 'atlas:response-chunk' (with tool result)
```

---

## Error Handling Contracts

All terminals must emit standardized errors:

```typescript
// Standard error format
interface AtlasError {
  code: string;           // e.g., 'VOICE_STT_FAILED'
  message: string;        // Technical message
  userMessage: string;    // User-friendly message
  terminal: 'CORE' | 'FLOW' | 'ORB' | 'TOOLS';
  recoverable: boolean;
  suggestedAction?: string;
}

// Error codes by terminal
const ERROR_CODES = {
  CORE: {
    VOICE_WAKE_FAILED: 'Wake word detection failed',
    VOICE_STT_FAILED: 'Speech recognition failed',
    VOICE_TTS_FAILED: 'Speech synthesis failed',
    LLM_REQUEST_FAILED: 'LLM request failed',
    LLM_TIMEOUT: 'LLM request timed out',
    MEMORY_STORAGE_FAILED: 'Failed to store memory',
    MEMORY_SEARCH_FAILED: 'Failed to search memories',
  },
  FLOW: {
    WORKFLOW_EXECUTION_FAILED: 'Workflow execution failed',
    WORKFLOW_TRIGGER_FAILED: 'Workflow trigger failed',
    INTEGRATION_AUTH_FAILED: 'Integration authentication failed',
    INTEGRATION_SYNC_FAILED: 'Integration sync failed',
  },
  ORB: {
    RENDER_FAILED: 'Orb rendering failed',
    WEBGL_NOT_SUPPORTED: 'WebGL not supported',
  },
  TOOLS: {
    TOOL_EXECUTION_FAILED: 'Tool execution failed',
    TOOL_PERMISSION_DENIED: 'Tool permission denied',
    TOOL_NOT_FOUND: 'Tool not found',
  },
};
```

---

**Last Updated**: 2026-01-15
