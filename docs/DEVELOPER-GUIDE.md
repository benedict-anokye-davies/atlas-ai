# Atlas Desktop - Developer Guide

> **Version:** 0.2.0
> **Last Updated:** January 15, 2026
> **Platform:** Windows, macOS, Linux

This guide provides comprehensive documentation for developers contributing to Atlas Desktop, a voice-first AI assistant built with Electron, React, and TypeScript.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Development Environment Setup](#development-environment-setup)
3. [Project Structure](#project-structure)
4. [Development Workflow](#development-workflow)
5. [Code Style and Conventions](#code-style-and-conventions)
6. [Testing Guidelines](#testing-guidelines)
7. [Adding New Features](#adding-new-features)
8. [Module Documentation](#module-documentation)
9. [Debugging](#debugging)
10. [Performance Optimization](#performance-optimization)
11. [Common Patterns](#common-patterns)
12. [Troubleshooting](#troubleshooting)

---

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | 18.x or 20.x | JavaScript runtime |
| npm | 9.x+ | Package manager |
| Git | 2.x+ | Version control |
| Python | 3.9+ | Native module compilation |
| Visual Studio Build Tools | 2022 (Windows only) | C++ compilation |

### Quick Start

```bash
# Clone the repository
git clone https://github.com/your-org/atlas-desktop.git
cd atlas-desktop

# Install dependencies
npm install

# Set up environment variables (see API Keys section)
cp .env.example .env

# Start development server
npm run dev
```

### API Keys Required

Atlas requires several API keys to function. Create a `.env` file in the project root:

```env
# Required Keys
PORCUPINE_API_KEY=your-picovoice-key       # Wake word detection
DEEPGRAM_API_KEY=your-deepgram-key         # Speech-to-text
FIREWORKS_API_KEY=your-fireworks-key       # Primary LLM
ELEVENLABS_API_KEY=your-elevenlabs-key     # Text-to-speech

# Optional Keys
OPENROUTER_API_KEY=your-openrouter-key     # Fallback LLM
ELEVENLABS_VOICE_ID=custom-voice-id        # Custom voice

# Development Settings
LOG_LEVEL=debug                            # debug|info|warn|error
NODE_ENV=development
```

**Getting API Keys:**
- Picovoice: https://console.picovoice.ai/
- Deepgram: https://console.deepgram.com/
- Fireworks AI: https://fireworks.ai/
- ElevenLabs: https://elevenlabs.io/
- OpenRouter: https://openrouter.ai/

---

## Development Environment Setup

### IDE Configuration

**Recommended: Visual Studio Code**

Install these extensions:
- ESLint (`dbaeumer.vscode-eslint`)
- Prettier (`esbenp.prettier-vscode`)
- TypeScript Vue Plugin (Volar) (`Vue.volar`)
- GitLens (`eamodio.gitlens`)
- Thunder Client (`rangav.vscode-thunder-client`) - API testing

**.vscode/settings.json** (project-level):
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "files.exclude": {
    "dist": true,
    "release": true,
    "node_modules": true
  }
}
```

### Development Commands

```bash
# Development
npm run dev              # Start app with hot reload
npm run dev:vite         # Start Vite dev server only
npm run dev:electron     # Start Electron only (requires Vite)

# Building
npm run build            # Full production build
npm run build:vite       # Build renderer only
npm run build:electron   # Compile main process

# Code Quality
npm run typecheck        # TypeScript type checking
npm run typecheck:main   # Check main process only
npm run lint             # ESLint with auto-fix
npm run format           # Prettier formatting

# Testing
npm run test             # Run all tests
npm run test:watch       # Watch mode
npm run test:coverage    # With coverage report
npm run test:smoke       # Smoke tests only

# Release
npm run release          # Interactive release
npm run release:patch    # Patch version bump
npm run release:minor    # Minor version bump
npm run release:major    # Major version bump
```

---

## Project Structure

```
atlas-desktop/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts            # App entry point
│   │   ├── preload.ts          # Preload script (IPC bridge)
│   │   ├── config/             # Configuration management
│   │   ├── voice/              # Voice pipeline components
│   │   │   ├── wake-word.ts    # Porcupine wake word
│   │   │   ├── vad.ts          # Voice activity detection
│   │   │   ├── pipeline.ts     # Audio pipeline
│   │   │   └── voice-pipeline.ts # Full pipeline orchestrator
│   │   ├── stt/                # Speech-to-text providers
│   │   │   ├── manager.ts      # STT manager
│   │   │   ├── deepgram.ts     # Cloud STT
│   │   │   ├── vosk.ts         # Offline STT
│   │   │   └── offline.ts      # Fallback handler
│   │   ├── llm/                # LLM integrations
│   │   │   ├── manager.ts      # LLM orchestrator
│   │   │   ├── fireworks.ts    # Primary provider
│   │   │   └── openrouter.ts   # Fallback provider
│   │   ├── tts/                # Text-to-speech providers
│   │   │   ├── manager.ts      # TTS manager
│   │   │   ├── elevenlabs.ts   # Cloud TTS
│   │   │   └── offline.ts      # System voice fallback
│   │   ├── agent/              # Agent tools & capabilities
│   │   │   ├── index.ts        # Agent orchestrator
│   │   │   ├── tools/          # Individual tools
│   │   │   └── personality-manager.ts
│   │   ├── memory/             # Memory system
│   │   │   ├── index.ts        # Memory manager
│   │   │   ├── vector-store/   # LanceDB integration
│   │   │   ├── retrieval/      # Semantic search
│   │   │   └── consolidation/  # Memory summarization
│   │   ├── security/           # Security layer
│   │   ├── ipc/                # IPC handlers
│   │   ├── tray/               # System tray
│   │   └── utils/              # Shared utilities
│   │
│   ├── renderer/               # React frontend
│   │   ├── main.tsx           # React entry point
│   │   ├── App.tsx            # Main app component
│   │   ├── components/
│   │   │   ├── orb/           # 3D visualization
│   │   │   │   ├── AtlasOrb.tsx
│   │   │   │   ├── AtlasParticles.tsx
│   │   │   │   ├── attractors.ts
│   │   │   │   └── shaders.ts
│   │   │   ├── Settings.tsx
│   │   │   └── DebugOverlay.tsx
│   │   ├── hooks/             # React hooks
│   │   │   ├── useAtlasState.ts
│   │   │   └── useAdaptiveParticles.ts
│   │   ├── stores/            # Zustand stores
│   │   ├── styles/            # CSS files
│   │   └── types/             # Renderer types
│   │
│   └── shared/                # Shared between processes
│       └── types/             # TypeScript interfaces
│           ├── agent.ts
│           ├── config.ts
│           ├── llm.ts
│           ├── stt.ts
│           ├── tts.ts
│           └── voice.ts
│
├── tests/                     # Test files
├── docs/                      # Documentation
├── assets/                    # Static assets (icons)
├── dist/                      # Build output
├── release/                   # Packaged builds
├── .env.example              # Environment template
├── package.json
├── tsconfig.json             # Renderer TypeScript config
├── tsconfig.main.json        # Main process TypeScript config
├── vite.config.ts
└── vitest.config.ts
```

---

## Development Workflow

### Branch Strategy

```
main              # Production-ready code
├── develop       # Integration branch
│   ├── feature/* # New features
│   ├── fix/*     # Bug fixes
│   └── refactor/*# Refactoring
└── release/*     # Release preparation
```

### Feature Development Flow

1. **Create a feature branch:**
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/my-feature
   ```

2. **Develop with tests:**
   ```bash
   npm run dev              # Start development server
   npm run test:watch       # Run tests in watch mode
   ```

3. **Verify quality before committing:**
   ```bash
   npm run typecheck        # Must pass
   npm run lint             # Must pass
   npm run test             # Must pass
   ```

4. **Commit with conventional format:**
   ```bash
   git add .
   git commit -m "feat(voice): add custom wake word support"
   ```

5. **Push and create PR:**
   ```bash
   git push -u origin feature/my-feature
   ```

### Commit Convention

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
type(scope): description

[optional body]

[optional footer]
```

**Types:**
| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Code style (formatting, no logic change) |
| `refactor` | Code change that neither fixes nor adds |
| `perf` | Performance improvement |
| `test` | Adding or updating tests |
| `chore` | Maintenance tasks |

**Scopes:**
| Scope | Area |
|-------|------|
| `voice` | Voice pipeline |
| `stt` | Speech-to-text |
| `llm` | Language models |
| `tts` | Text-to-speech |
| `orb` | Visualization |
| `agent` | Agent tools |
| `memory` | Memory system |
| `ipc` | IPC handlers |
| `security` | Security features |
| `ui` | User interface |

**Examples:**
```
feat(voice): implement custom wake word training
fix(stt): handle Deepgram connection timeout
test(llm): add unit tests for Fireworks integration
docs(readme): update installation instructions
perf(orb): optimize particle shader performance
refactor(memory): extract vector store interface
```

---

## Code Style and Conventions

### TypeScript Guidelines

1. **Use strict mode** - All code must pass strict type checking
   ```typescript
   // Good: Explicit types
   function processAudio(buffer: Buffer, options: ProcessOptions): ProcessResult {
     // ...
   }

   // Avoid: 'any' type
   function processAudio(buffer: any): any { } // Bad
   ```

2. **Prefer interfaces over type aliases for objects:**
   ```typescript
   // Good
   interface UserConfig {
     name: string;
     preferences: UserPreferences;
   }

   // Use type for unions, primitives, functions
   type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';
   ```

3. **Use enums sparingly, prefer const objects:**
   ```typescript
   // Prefer this
   const VoiceStates = {
     IDLE: 'idle',
     LISTENING: 'listening',
     PROCESSING: 'processing',
     SPEAKING: 'speaking',
   } as const;
   type VoiceState = typeof VoiceStates[keyof typeof VoiceStates];

   // Over enum (has runtime overhead)
   enum VoiceState { Idle, Listening, Processing, Speaking }
   ```

4. **Export types separately from implementations:**
   ```typescript
   // types.ts
   export interface STTResult {
     text: string;
     isFinal: boolean;
     confidence: number;
   }

   // deepgram.ts
   import type { STTResult } from './types';
   ```

### Naming Conventions

| Entity | Convention | Example |
|--------|------------|---------|
| Files (general) | kebab-case | `wake-word.ts` |
| React components | PascalCase | `AtlasOrb.tsx` |
| Classes | PascalCase | `VoicePipeline` |
| Interfaces | PascalCase (I prefix optional) | `VoiceConfig` |
| Functions | camelCase | `processAudio()` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_BUFFER_SIZE` |
| Variables | camelCase | `audioLevel` |
| Private members | underscore prefix | `_isRunning` |

### Code Organization

```typescript
// 1. Imports (grouped and ordered)
import { EventEmitter } from 'events';          // Node.js builtins
import { BrowserWindow } from 'electron';       // External packages
import { createModuleLogger } from '../utils';  // Internal modules
import type { VoiceConfig } from './types';     // Type imports last

// 2. Constants
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 3;

// 3. Types/Interfaces (if not in separate file)
interface ProcessOptions {
  timeout?: number;
  retries?: number;
}

// 4. Class/Function implementation
export class VoicePipeline extends EventEmitter {
  // Private fields first
  private readonly config: VoiceConfig;
  private isRunning = false;

  // Constructor
  constructor(config: VoiceConfig) {
    super();
    this.config = config;
  }

  // Public methods
  async start(): Promise<void> {
    // ...
  }

  // Private methods
  private async initialize(): Promise<void> {
    // ...
  }
}

// 5. Singleton/Factory exports (if applicable)
let instance: VoicePipeline | null = null;

export function getVoicePipeline(): VoicePipeline {
  if (!instance) {
    instance = new VoicePipeline(getConfig());
  }
  return instance;
}
```

### React Component Structure

```tsx
// 1. Imports
import { useState, useEffect, useCallback } from 'react';
import { useAtlasStore } from '../stores';
import type { OrbProps } from './types';

// 2. Props interface
interface AtlasOrbProps {
  state: VoiceState;
  audioLevel: number;
  onStateClick?: () => void;
}

// 3. Component
export function AtlasOrb({ state, audioLevel, onStateClick }: AtlasOrbProps) {
  // Hooks (in order: state, context, refs, effects, callbacks)
  const [isAnimating, setIsAnimating] = useState(false);
  const { settings } = useAtlasStore();

  useEffect(() => {
    // Effect logic
  }, [state]);

  const handleClick = useCallback(() => {
    onStateClick?.();
  }, [onStateClick]);

  // Render
  return (
    <div className="atlas-orb" onClick={handleClick}>
      {/* Content */}
    </div>
  );
}

// 4. Display name (for debugging)
AtlasOrb.displayName = 'AtlasOrb';
```

### ESLint Rules

The project uses the following ESLint configuration:

```javascript
// Key rules enforced:
{
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/explicit-function-return-type": "warn",
  "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
  "react-hooks/rules-of-hooks": "error",
  "react-hooks/exhaustive-deps": "warn",
  "no-console": ["warn", { "allow": ["warn", "error"] }]
}
```

### Prettier Configuration

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100,
  "arrowParens": "always"
}
```

---

## Testing Guidelines

### Test Structure

```
tests/
├── unit/                    # Unit tests
│   ├── voice/
│   ├── stt/
│   ├── llm/
│   └── tts/
├── integration/             # Integration tests
│   ├── pipeline.test.ts
│   └── ipc.test.ts
├── e2e/                     # End-to-end tests
├── smoke/                   # Quick smoke tests
└── fixtures/                # Test data
```

### Writing Unit Tests

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WakeWordDetector } from '../../../src/main/voice/wake-word';

describe('WakeWordDetector', () => {
  let detector: WakeWordDetector;

  beforeEach(() => {
    detector = new WakeWordDetector({
      accessKey: 'test-key',
      keywords: ['hey atlas'],
      sensitivities: [0.7],
    });
  });

  afterEach(async () => {
    await detector.shutdown();
  });

  describe('initialization', () => {
    it('should initialize with valid config', async () => {
      await expect(detector.initialize()).resolves.not.toThrow();
    });

    it('should throw with invalid access key', async () => {
      const badDetector = new WakeWordDetector({
        accessKey: '',
        keywords: ['hey atlas'],
        sensitivities: [0.7],
      });
      await expect(badDetector.initialize()).rejects.toThrow();
    });
  });

  describe('detection', () => {
    it('should emit wake event on detection', async () => {
      const onWake = vi.fn();
      detector.on('wake', onWake);

      // Simulate detection
      detector['handleDetection'](0, 0.85);

      expect(onWake).toHaveBeenCalledWith(
        expect.objectContaining({
          keyword: 'hey atlas',
          confidence: expect.any(Number),
        })
      );
    });
  });
});
```

### Mocking External Services

```typescript
import { vi } from 'vitest';

// Mock Deepgram SDK
vi.mock('@deepgram/sdk', () => ({
  createClient: vi.fn(() => ({
    listen: {
      live: vi.fn(() => ({
        on: vi.fn(),
        send: vi.fn(),
        finish: vi.fn(),
      })),
    },
  })),
}));

// Mock Electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test'),
    getVersion: vi.fn(() => '0.2.0'),
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
}));
```

### Test Coverage Requirements

- **Target coverage:** 80%+ for new code
- **Required coverage areas:**
  - All public methods
  - Error handling paths
  - Edge cases
  - Integration points

Run coverage report:
```bash
npm run test:coverage
```

---

## Adding New Features

### Adding a New Agent Tool

1. **Create the tool file:**
   ```typescript
   // src/main/agent/tools/my-tool.ts
   import { createModuleLogger } from '../../utils/logger';
   import type { ToolResult } from '../../../shared/types/agent';

   const logger = createModuleLogger('MyTool');

   export interface MyToolOptions {
     param1: string;
     param2?: number;
   }

   export async function executeTool(options: MyToolOptions): Promise<ToolResult> {
     logger.info('Executing my tool', { options });

     try {
       // Tool implementation
       const result = await doSomething(options);

       return {
         success: true,
         data: result,
       };
     } catch (error) {
       logger.error('Tool execution failed', { error });
       return {
         success: false,
         error: (error as Error).message,
       };
     }
   }
   ```

2. **Register the tool:**
   ```typescript
   // src/main/agent/tools/index.ts
   import { executeTool as myTool } from './my-tool';

   export const tools = {
     // ... existing tools
     myTool,
   };
   ```

3. **Add LLM tool definition:**
   ```typescript
   // src/main/agent/llm-tools.ts
   export const toolDefinitions = [
     // ... existing definitions
     {
       type: 'function',
       function: {
         name: 'my_tool',
         description: 'Description of what the tool does',
         parameters: {
           type: 'object',
           properties: {
             param1: {
               type: 'string',
               description: 'Description of param1',
             },
             param2: {
               type: 'number',
               description: 'Optional param2',
             },
           },
           required: ['param1'],
         },
       },
     },
   ];
   ```

4. **Add types:**
   ```typescript
   // src/shared/types/agent.ts
   export interface MyToolOptions {
     param1: string;
     param2?: number;
   }
   ```

5. **Write tests:**
   ```typescript
   // tests/unit/agent/my-tool.test.ts
   import { describe, it, expect } from 'vitest';
   import { executeTool } from '../../../src/main/agent/tools/my-tool';

   describe('MyTool', () => {
     it('should execute successfully with valid options', async () => {
       const result = await executeTool({ param1: 'test' });
       expect(result.success).toBe(true);
     });
   });
   ```

### Adding an IPC Handler

1. **Define types:**
   ```typescript
   // src/shared/types/my-feature.ts
   export interface MyFeatureRequest {
     action: string;
     data: unknown;
   }

   export interface MyFeatureResponse {
     success: boolean;
     result?: unknown;
     error?: string;
   }
   ```

2. **Implement handler:**
   ```typescript
   // src/main/ipc/handlers.ts (add to existing)

   // In registerIPCHandlers():
   ipcMain.handle('atlas:my-feature', async (_event, request: unknown): Promise<IPCResult> => {
     // Validate input
     const validation = validateConfigObject(request);
     if (!validation.valid) {
       return { success: false, error: validation.error };
     }

     try {
       const result = await processMyFeature(validation.sanitized);
       return { success: true, data: result };
     } catch (error) {
       return { success: false, error: (error as Error).message };
     }
   });
   ```

3. **Expose in preload:**
   ```typescript
   // src/main/preload.ts
   const atlasAPI = {
     // ... existing methods
     myFeature: (request: MyFeatureRequest) =>
       ipcRenderer.invoke('atlas:my-feature', request),
   };
   ```

4. **Add types for renderer:**
   ```typescript
   // src/renderer/types/atlas.d.ts
   interface AtlasAPI {
     // ... existing
     myFeature(request: MyFeatureRequest): Promise<MyFeatureResponse>;
   }
   ```

5. **Use in React:**
   ```typescript
   // src/renderer/hooks/useMyFeature.ts
   import { useCallback, useState } from 'react';

   export function useMyFeature() {
     const [loading, setLoading] = useState(false);
     const [error, setError] = useState<string | null>(null);

     const execute = useCallback(async (request: MyFeatureRequest) => {
       setLoading(true);
       setError(null);

       try {
         const result = await window.atlas.myFeature(request);
         if (!result.success) {
           throw new Error(result.error);
         }
         return result.result;
       } catch (err) {
         setError((err as Error).message);
         throw err;
       } finally {
         setLoading(false);
       }
     }, []);

     return { execute, loading, error };
   }
   ```

---

## Module Documentation

### Voice Pipeline

The voice pipeline is the core of Atlas, orchestrating all voice interactions:

```
Wake Word Detection --> VAD --> STT --> LLM --> TTS
     (Porcupine)     (Silero) (Deepgram) (Fireworks) (ElevenLabs)
```

**Key Files:**
- `src/main/voice/voice-pipeline.ts` - Main orchestrator
- `src/main/voice/wake-word.ts` - Wake word detection
- `src/main/voice/vad.ts` - Voice activity detection
- `src/main/voice/pipeline.ts` - Audio pipeline

**State Machine:**
```
idle --> listening --> processing --> speaking --> idle
  ^                        |             |
  |                        v             |
  +-------- error <--------+-------------+
```

### Provider Manager Pattern

All service providers (STT, LLM, TTS) follow a common pattern:

```typescript
class ProviderManager extends EventEmitter {
  private primaryProvider: Provider;
  private fallbackProviders: Provider[];
  private circuitBreaker: CircuitBreaker;

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await this.circuitBreaker.execute(
        () => this.primaryProvider.execute(operation)
      );
    } catch (error) {
      return await this.tryFallback(operation);
    }
  }
}
```

### Memory System

The memory system provides persistent conversation storage and semantic search:

**Components:**
- `MemoryManager` - Orchestrates memory operations
- `VectorStore` - LanceDB for embeddings
- `SemanticChunker` - Splits text into meaningful chunks
- `ContextBuilder` - Assembles context for LLM

---

## Debugging

### Using the Logger

```typescript
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('MyModule');

// Log levels
logger.debug('Detailed debugging info', { data });
logger.info('General information');
logger.warn('Warning message', { reason });
logger.error('Error occurred', { error, context });
```

**Log Location:** `~/.atlas/logs/`

### Debug Overlay

Press `Ctrl+D` (or `Cmd+D` on macOS) to toggle the debug overlay in development mode.

### DevTools

In development, DevTools opens automatically. You can also:
- Press `Ctrl+Shift+I` to toggle
- Use `View > Toggle Developer Tools` menu

### IPC Debugging

Add IPC logging in development:
```typescript
// In main process
ipcMain.handle('atlas:my-channel', async (event, ...args) => {
  logger.debug('IPC received', { channel: 'atlas:my-channel', args });
  // ...
});
```

---

## Performance Optimization

### Performance Targets

| Metric | Target |
|--------|--------|
| Startup | <3s cold, <1s warm |
| Wake word latency | <200ms |
| STT latency | <300ms |
| LLM first token | <2s |
| TTS first audio | <500ms |
| Total response | <3s typical |
| Memory usage | <500MB |
| Orb framerate | 60fps |

### Optimization Techniques

1. **Lazy Loading:** Non-critical modules are loaded on demand
2. **Connection Warmup:** API connections pre-established at startup
3. **Streaming:** All providers use streaming where possible
4. **Circuit Breaker:** Prevents cascade failures
5. **Caching:** LLM responses cached for repeated queries

### Profiling

```typescript
import { PerformanceTimer } from '../utils/logger';

const timer = new PerformanceTimer('MyOperation');
timer.start('step1');
// ... do work
timer.end('step1');
timer.start('step2');
// ... more work
timer.end('step2');
// Logs timing information
```

---

## Common Patterns

### Singleton Pattern (Service Managers)

```typescript
let instance: MyManager | null = null;

export function getMyManager(): MyManager {
  if (!instance) {
    instance = new MyManager();
  }
  return instance;
}

export async function shutdownMyManager(): Promise<void> {
  if (instance) {
    await instance.shutdown();
    instance = null;
  }
}
```

### Circuit Breaker Pattern

```typescript
import { CircuitBreaker } from '../utils/errors';

const breaker = new CircuitBreaker({
  failureThreshold: 3,
  timeout: 60000,
});

async function callExternalService(): Promise<Result> {
  return breaker.execute(async () => {
    return await externalApi.call();
  });
}
```

### Event-Driven Communication

```typescript
class MyService extends EventEmitter {
  emit(event: 'data', data: DataType): boolean;
  emit(event: 'error', error: Error): boolean;
  emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  on(event: 'data', listener: (data: DataType) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }
}
```

---

## Troubleshooting

### Common Issues

**Wake word not detecting:**
- Check `PORCUPINE_API_KEY` in `.env`
- Verify microphone permissions
- Check audio device selection
- Review logs in `~/.atlas/logs/`

**No LLM response:**
- Verify `FIREWORKS_API_KEY` or `OPENROUTER_API_KEY`
- Check network connectivity
- Look for rate limiting errors

**TypeScript errors:**
```bash
npm run typecheck  # See all errors
```

**Electron not starting:**
- Run `npm install` to ensure dependencies
- Check for port 5173 conflicts (Vite)
- Look at terminal output for errors

**Tests failing:**
```bash
npm run test -- --reporter=verbose  # Detailed output
```

### Getting Help

1. Check existing issues on GitHub
2. Search logs in `~/.atlas/logs/`
3. Enable debug logging: `LOG_LEVEL=debug npm run dev`
4. Join the Discord community (if available)

---

## Next Steps

- Read [ARCHITECTURE.md](./ARCHITECTURE.md) for system design details
- Read [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines
- Explore the codebase starting with `src/main/voice/voice-pipeline.ts`
- Run the test suite to understand expected behavior

---

**Last Updated:** January 15, 2026
