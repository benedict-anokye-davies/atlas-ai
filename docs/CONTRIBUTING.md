# Contributing to Atlas Desktop

Thank you for your interest in contributing to Atlas Desktop! This document provides guidelines and instructions for contributing to the project.

---

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [How to Contribute](#how-to-contribute)
4. [Development Process](#development-process)
5. [Pull Request Process](#pull-request-process)
6. [Code Review Guidelines](#code-review-guidelines)
7. [Issue Guidelines](#issue-guidelines)
8. [Style Guide](#style-guide)
9. [Testing Requirements](#testing-requirements)
10. [Documentation](#documentation)
11. [Community](#community)

---

## Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inclusive environment for all contributors. We expect all participants to:

- Be respectful and considerate
- Welcome newcomers and help them learn
- Accept constructive criticism gracefully
- Focus on what is best for the community
- Show empathy towards other community members

### Unacceptable Behavior

- Harassment, discrimination, or offensive comments
- Trolling, insulting, or derogatory remarks
- Publishing private information without consent
- Other conduct deemed inappropriate in a professional setting

### Enforcement

Violations of the code of conduct may result in temporary or permanent bans from the project. Report concerns to the maintainers.

---

## Getting Started

### Prerequisites

Before contributing, ensure you have:

1. **Development environment set up** - See [DEVELOPER-GUIDE.md](./DEVELOPER-GUIDE.md)
2. **Understanding of the architecture** - See [ARCHITECTURE.md](./ARCHITECTURE.md)
3. **API keys** - Required for testing voice features
4. **Git** - For version control

### First-Time Setup

```bash
# Fork the repository on GitHub

# Clone your fork
git clone https://github.com/YOUR_USERNAME/atlas-desktop.git
cd atlas-desktop

# Add upstream remote
git remote add upstream https://github.com/atlas-team/atlas-desktop.git

# Install dependencies
npm install

# Create environment file
cp .env.example .env
# Edit .env with your API keys

# Verify setup
npm run dev
npm run test
```

### Finding Your First Issue

Look for issues labeled:
- `good first issue` - Suitable for newcomers
- `help wanted` - We'd appreciate help
- `documentation` - Documentation improvements
- `bug` - Known bugs that need fixing

---

## How to Contribute

### Types of Contributions

We welcome many types of contributions:

| Contribution Type | Description |
|------------------|-------------|
| **Bug Fixes** | Fix reported issues |
| **Features** | Implement new functionality |
| **Documentation** | Improve docs, add examples |
| **Tests** | Add or improve test coverage |
| **Performance** | Optimize code performance |
| **Refactoring** | Improve code structure |
| **UI/UX** | Improve user interface |
| **Accessibility** | Improve accessibility |
| **Translations** | Add language support |

### Contribution Workflow

```
1. Find or create an issue
         |
         v
2. Fork and create branch
         |
         v
3. Make changes with tests
         |
         v
4. Run quality checks
         |
         v
5. Create pull request
         |
         v
6. Address review feedback
         |
         v
7. Merge (by maintainer)
```

---

## Development Process

### Branch Naming

Use descriptive branch names following this pattern:

```
<type>/<issue-number>-<short-description>
```

**Examples:**
```bash
feature/123-custom-wake-word
fix/456-deepgram-timeout
docs/789-api-documentation
refactor/101-stt-manager
test/102-llm-coverage
```

### Development Cycle

1. **Sync with upstream:**
   ```bash
   git fetch upstream
   git checkout develop
   git merge upstream/develop
   ```

2. **Create feature branch:**
   ```bash
   git checkout -b feature/123-my-feature
   ```

3. **Make changes:**
   - Write code following style guide
   - Add/update tests
   - Update documentation if needed

4. **Run quality checks:**
   ```bash
   npm run typecheck    # TypeScript
   npm run lint         # ESLint
   npm run test         # Tests
   ```

5. **Commit with meaningful messages:**
   ```bash
   git add .
   git commit -m "feat(voice): add custom wake word support

   - Add WakeWordTrainer class for custom model creation
   - Add UI for recording training samples
   - Update documentation with training instructions

   Closes #123"
   ```

6. **Push and create PR:**
   ```bash
   git push -u origin feature/123-my-feature
   ```

### Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Format Rules:**
- Use imperative mood ("add feature" not "added feature")
- First line max 72 characters
- Body wrapped at 72 characters
- Reference issues in footer

**Types:**

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Code style (formatting) |
| `refactor` | Code change (no feature/fix) |
| `perf` | Performance improvement |
| `test` | Adding tests |
| `chore` | Maintenance tasks |
| `ci` | CI/CD changes |
| `revert` | Revert previous commit |

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
| `security` | Security |
| `ui` | User interface |
| `config` | Configuration |
| `deps` | Dependencies |

**Examples:**

```
feat(voice): add custom wake word training

Implement WakeWordTrainer class that allows users to create
custom wake word models by recording voice samples.

- Add training data collection UI
- Implement model training pipeline
- Add model validation and testing
- Update settings with wake word management

Closes #123

---

fix(stt): handle Deepgram connection timeout

Add timeout handling for Deepgram WebSocket connections.
Falls back to Vosk when connection fails.

Fixes #456

---

docs(readme): update installation instructions

- Add Windows-specific build requirements
- Update Node.js version requirements
- Add troubleshooting section
```

---

## Pull Request Process

### Before Submitting

Ensure your PR meets these requirements:

- [ ] All tests pass (`npm run test`)
- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] ESLint passes (`npm run lint`)
- [ ] Code is properly formatted (`npm run format`)
- [ ] Documentation updated (if applicable)
- [ ] Commit messages follow convention
- [ ] Branch is up to date with develop

### PR Template

When creating a PR, use this template:

```markdown
## Summary

Brief description of changes.

## Related Issue

Fixes #(issue number)

## Type of Change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update

## Changes Made

- Change 1
- Change 2
- Change 3

## Testing

Describe how you tested your changes:

1. Test scenario 1
2. Test scenario 2

## Screenshots (if applicable)

Include screenshots for UI changes.

## Checklist

- [ ] My code follows the project style guidelines
- [ ] I have performed a self-review of my code
- [ ] I have commented my code where necessary
- [ ] I have updated documentation accordingly
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix/feature works
- [ ] New and existing tests pass locally
- [ ] Any dependent changes have been merged
```

### PR Size Guidelines

Keep PRs small and focused:

| Size | Lines Changed | Recommended |
|------|--------------|-------------|
| XS | < 50 | Ideal |
| S | 50-200 | Good |
| M | 200-500 | Acceptable |
| L | 500-1000 | Split if possible |
| XL | > 1000 | Split required |

### Review Timeline

- Initial review: Within 2 business days
- Follow-up reviews: Within 1 business day
- Merging: After approval and passing CI

---

## Code Review Guidelines

### For Authors

1. **Respond to all comments** - Even if just acknowledging
2. **Be open to feedback** - Reviewers want to help improve the code
3. **Explain your decisions** - Help reviewers understand your approach
4. **Request re-review** - After addressing comments
5. **Don't take it personally** - Reviews are about code, not you

### For Reviewers

1. **Be constructive** - Suggest improvements, don't just criticize
2. **Be specific** - Point to exact lines, suggest solutions
3. **Be timely** - Review within agreed timeline
4. **Approve when ready** - Don't delay for minor issues
5. **Use conventions:**

   | Prefix | Meaning |
   |--------|---------|
   | `nit:` | Minor style issue, non-blocking |
   | `suggestion:` | Optional improvement |
   | `question:` | Need clarification |
   | `issue:` | Must be addressed |
   | `praise:` | Something done well |

### Review Checklist

- [ ] Code is readable and well-structured
- [ ] Logic is correct and handles edge cases
- [ ] Error handling is appropriate
- [ ] Performance is acceptable
- [ ] Security considerations addressed
- [ ] Tests are adequate
- [ ] Documentation is updated

---

## Issue Guidelines

### Bug Reports

Use this template for bug reports:

```markdown
## Bug Description

Clear description of the bug.

## Steps to Reproduce

1. Go to '...'
2. Click on '...'
3. Say '...'
4. See error

## Expected Behavior

What you expected to happen.

## Actual Behavior

What actually happened.

## Environment

- OS: [e.g., Windows 11, macOS 14]
- Atlas Version: [e.g., 0.2.0]
- Node Version: [e.g., 20.10.0]

## Screenshots/Logs

If applicable, add screenshots or log output.

## Additional Context

Any other relevant information.
```

### Feature Requests

Use this template for feature requests:

```markdown
## Feature Description

Clear description of the proposed feature.

## Problem It Solves

What problem does this feature solve?

## Proposed Solution

How you envision this working.

## Alternatives Considered

Other solutions you've thought about.

## Additional Context

Any other relevant information.
```

### Issue Labels

| Label | Description |
|-------|-------------|
| `bug` | Something isn't working |
| `feature` | New feature request |
| `enhancement` | Improvement to existing feature |
| `documentation` | Documentation improvements |
| `good first issue` | Good for newcomers |
| `help wanted` | Extra attention needed |
| `priority: high` | High priority |
| `priority: low` | Low priority |
| `blocked` | Blocked by another issue |
| `duplicate` | Duplicate of another issue |
| `wontfix` | Will not be addressed |

---

## Style Guide

### General Principles

1. **Readability** - Code should be self-documenting
2. **Consistency** - Follow existing patterns
3. **Simplicity** - Prefer simple solutions
4. **Testability** - Write testable code

### TypeScript

```typescript
// Use explicit types for function parameters and returns
function processAudio(buffer: Buffer, options: ProcessOptions): ProcessResult {
  // ...
}

// Use interfaces for objects
interface UserConfig {
  name: string;
  preferences: UserPreferences;
}

// Use type for unions and simple types
type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

// Avoid 'any' - use 'unknown' if type is truly unknown
function handleUnknown(data: unknown): void {
  if (typeof data === 'string') {
    // Now TypeScript knows data is string
  }
}

// Use readonly for immutable data
interface Config {
  readonly apiKey: string;
  readonly timeout: number;
}

// Prefer const assertions for constants
const VOICE_STATES = ['idle', 'listening', 'processing', 'speaking'] as const;
```

### React Components

```tsx
// Use functional components with TypeScript
interface ButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export function Button({ label, onClick, disabled = false }: ButtonProps) {
  return (
    <button
      className="atlas-button"
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

// Set display name for debugging
Button.displayName = 'Button';
```

### File Organization

```typescript
// 1. Node.js built-ins
import { EventEmitter } from 'events';
import { join } from 'path';

// 2. External packages
import { BrowserWindow } from 'electron';
import { create } from 'zustand';

// 3. Internal modules (absolute paths)
import { createModuleLogger } from '../utils/logger';
import { VoicePipeline } from '../voice/voice-pipeline';

// 4. Type imports (last)
import type { VoiceConfig, VoiceState } from './types';

// 5. Constants
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 3;

// 6. Interfaces/Types (if not in separate file)
interface Options {
  timeout?: number;
}

// 7. Main implementation
export class MyClass {
  // ...
}

// 8. Singleton/Factory (if applicable)
export function getInstance(): MyClass {
  // ...
}
```

### Naming Conventions

| Entity | Convention | Example |
|--------|------------|---------|
| Files | kebab-case | `voice-pipeline.ts` |
| React files | PascalCase | `AtlasOrb.tsx` |
| Classes | PascalCase | `VoicePipeline` |
| Interfaces | PascalCase | `VoiceConfig` |
| Functions | camelCase | `processAudio` |
| Variables | camelCase | `audioLevel` |
| Constants | SCREAMING_SNAKE | `MAX_BUFFER_SIZE` |
| Private members | underscore prefix | `_isRunning` |
| Enum values | PascalCase | `VoiceState.Listening` |

---

## Testing Requirements

### Test Coverage

- **Minimum:** 80% for new code
- **Goal:** 90%+ for critical paths

### What to Test

| Priority | What | Example |
|----------|------|---------|
| High | Business logic | Voice pipeline state machine |
| High | Error handling | API failure scenarios |
| High | Edge cases | Empty input, timeouts |
| Medium | Integration | IPC handlers |
| Medium | UI interactions | Button clicks, form submission |
| Low | Styling | CSS classes applied correctly |

### Test Structure

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('MyClass', () => {
  // Group related tests
  describe('initialization', () => {
    it('should initialize with default config', () => {
      // Arrange
      const config = {};

      // Act
      const instance = new MyClass(config);

      // Assert
      expect(instance).toBeDefined();
    });

    it('should throw on invalid config', () => {
      expect(() => new MyClass(null)).toThrow();
    });
  });

  describe('process', () => {
    let instance: MyClass;

    beforeEach(() => {
      instance = new MyClass({ timeout: 1000 });
    });

    afterEach(async () => {
      await instance.cleanup();
    });

    it('should process valid input', async () => {
      const result = await instance.process('valid input');
      expect(result.success).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      const result = await instance.process('');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
```

### Mocking

```typescript
import { vi } from 'vitest';

// Mock modules
vi.mock('@deepgram/sdk', () => ({
  createClient: vi.fn(() => ({
    listen: { live: vi.fn() },
  })),
}));

// Mock functions
const mockFn = vi.fn()
  .mockReturnValue('default')
  .mockReturnValueOnce('first call')
  .mockResolvedValue(Promise.resolve('async result'));

// Spy on methods
const spy = vi.spyOn(instance, 'method');
expect(spy).toHaveBeenCalledWith('arg');

// Reset between tests
beforeEach(() => {
  vi.clearAllMocks();
});
```

---

## Documentation

### When to Document

- New features
- API changes
- Configuration options
- Complex algorithms
- Breaking changes

### Documentation Types

1. **Code Comments**
   ```typescript
   /**
    * Processes audio buffer and returns transcription.
    *
    * @param buffer - Raw audio buffer (16-bit PCM, 16kHz)
    * @param options - Processing options
    * @returns Transcription result with confidence score
    * @throws {AudioError} If buffer is invalid
    *
    * @example
    * ```typescript
    * const result = await processAudio(buffer, { language: 'en' });
    * console.log(result.text);
    * ```
    */
   async function processAudio(
     buffer: Buffer,
     options: ProcessOptions
   ): Promise<TranscriptionResult> {
     // Implementation
   }
   ```

2. **README Updates**
   - Installation changes
   - Configuration changes
   - Breaking changes

3. **API Documentation**
   - New IPC handlers
   - Type definitions
   - Event signatures

4. **Architecture Docs**
   - New modules
   - Design decisions
   - Flow diagrams

---

## Community

### Communication Channels

- **GitHub Issues** - Bug reports, feature requests
- **GitHub Discussions** - Questions, ideas, announcements
- **Discord** - Real-time chat (if available)

### Getting Help

1. Check existing documentation
2. Search closed issues
3. Ask in GitHub Discussions
4. Create a new issue if needed

### Recognition

Contributors are recognized in:
- `CONTRIBUTORS.md` file
- Release notes
- Project documentation

---

## Thank You!

We appreciate your contributions to Atlas Desktop. Every contribution, no matter how small, helps make the project better for everyone.

If you have questions about contributing, please open a discussion on GitHub.

---

**Last Updated:** January 15, 2026
