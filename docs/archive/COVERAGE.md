# Test Coverage Guide

This document describes the test coverage strategy, tooling, and best practices for Atlas Desktop.

## Overview

Atlas Desktop targets **80% code coverage** across all modules. Coverage is measured using Vitest with the V8 coverage provider, which provides accurate coverage data for TypeScript applications.

## Quick Start

```bash
# Run tests with coverage
npm run test:coverage

# Generate coverage report
npx ts-node scripts/coverage-report.ts

# CI mode with threshold enforcement
npx ts-node scripts/coverage-report.ts --ci

# View coverage trends
npx ts-node scripts/coverage-report.ts --trend

# Generate coverage badges
npx ts-node scripts/coverage-report.ts --badge
```

## Coverage Thresholds

| Metric | Target | Rationale |
|--------|--------|-----------|
| Lines | 80% | Standard target for well-tested code |
| Statements | 80% | Ensures most code paths are executed |
| Functions | 80% | Validates all public APIs are tested |
| Branches | 70% | Slightly lower due to error handling branches |

### Per-Module Targets

Some modules require higher coverage due to their critical nature:

| Module | Target | Notes |
|--------|--------|-------|
| main/security | 90% | Security-critical code |
| main/voice | 85% | Core voice pipeline |
| main/llm | 80% | LLM integrations |
| main/memory | 85% | Data persistence |
| renderer/stores | 80% | State management |
| shared/types | N/A | Type definitions only |

## Coverage Reports

### Console Report

Running `npx ts-node scripts/coverage-report.ts` produces a detailed console report:

```
================================================================================
                    ATLAS DESKTOP - COVERAGE REPORT
================================================================================
Timestamp: 2024-01-15T10:30:00.000Z
Commit: abc1234 | Branch: main

--- Overall Coverage Summary ---
  Lines:      82.45% (PASS) (1234/1496)
  Statements: 81.20% (PASS) (1456/1793)
  Functions:  84.30% (PASS) (245/291)
  Branches:   72.15% (PASS) (312/432)

--- Threshold Status ---
  Overall: PASS
  Lines:      PASS (target: 80%, actual: 82.45%, delta: +2.45%)
  ...

--- Per-Module Coverage ---
Module                          | Lines    | Stmts    | Funcs    | Branch
--------------------------------------------------------------------------------
main/agent                      |  85.2%  |  84.1%  |  88.0%  |  71.2%
main/llm                        |  82.1%  |  81.5%  |  85.0%  |  70.5%
...
```

### JSON Report

For programmatic access, use `--json`:

```bash
npx ts-node scripts/coverage-report.ts --json > coverage-report.json
```

### HTML Report

Vitest generates an HTML report in `coverage/index.html`:

```bash
npm run test:coverage
# Open coverage/index.html in browser
```

## Coverage Badges

Generate SVG badges for your README:

```bash
npx ts-node scripts/coverage-report.ts --badge
```

This creates:
- `badges/coverage.svg` - Overall coverage badge
- `badges/lines.svg` - Lines coverage
- `badges/statements.svg` - Statements coverage
- `badges/functions.svg` - Functions coverage
- `badges/branches.svg` - Branches coverage
- `badges/shields.json` - shields.io compatible JSON

### Adding to README

```markdown
![Coverage](./badges/coverage.svg)
![Lines](./badges/lines.svg)
![Functions](./badges/functions.svg)
```

Or using shields.io endpoint:

```markdown
![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/atlas-team/atlas-desktop/main/badges/shields.json)
```

## Coverage Trends

Track coverage changes over time:

```bash
npx ts-node scripts/coverage-report.ts --trend
```

Output:
```
=== Coverage Trend (Last 10 Entries) ===

Date                 | Commit  | Lines    | Stmts    | Funcs    | Branch
--------------------------------------------------------------------------------
2024-01-10 09:15:00 | abc123  |  78.5%  |  77.2%  |  80.0%  |  68.5%
2024-01-12 14:30:00 | def456  |  80.1%  |  79.5%  |  82.0%  |  70.2%
2024-01-15 10:30:00 | ghi789  |  82.4%  |  81.2%  |  84.3%  |  72.1%

--- Trend vs Previous ---
Lines: +2.30% | Statements: +1.70% | Functions: +2.30% | Branches: +1.90%
```

Trend data is stored in `coverage/coverage-trend.json`.

## CI Integration

### GitHub Actions

Add coverage gates to your CI pipeline:

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: npm ci

      - name: Run tests with coverage
        run: npm run test:coverage

      - name: Check coverage thresholds
        run: npx ts-node scripts/coverage-report.ts --ci

      - name: Upload coverage report
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/
```

### Coverage Gates

The `--ci` flag enforces thresholds:
- Exit code 0: All thresholds met
- Exit code 1: One or more thresholds failed

Custom thresholds:
```bash
npx ts-node scripts/coverage-report.ts --ci \
  --threshold-lines 85 \
  --threshold-functions 85 \
  --threshold-branches 75
```

## Writing Tests for Coverage

### Best Practices

1. **Test public APIs first**
   ```typescript
   // Good - tests the public interface
   describe('VoicePipeline', () => {
     it('should process audio correctly', async () => {
       const pipeline = new VoicePipeline();
       const result = await pipeline.process(audioBuffer);
       expect(result.transcript).toBeDefined();
     });
   });
   ```

2. **Cover error paths**
   ```typescript
   it('should handle API errors gracefully', async () => {
     mockApi.mockRejectedValue(new Error('Network error'));
     await expect(service.fetch()).rejects.toThrow('Network error');
   });
   ```

3. **Test edge cases**
   ```typescript
   it('should handle empty input', () => {
     expect(processor.process('')).toBe('');
   });

   it('should handle null values', () => {
     expect(processor.process(null)).toBeNull();
   });
   ```

4. **Cover all branches**
   ```typescript
   // For code like:
   // if (config.enabled) { ... } else { ... }

   it('should work when enabled', () => { ... });
   it('should work when disabled', () => { ... });
   ```

### Files to Prioritize

Focus testing efforts on:

1. **Business logic** - Agent tools, memory system, LLM integration
2. **Security code** - Input validation, safe execution
3. **State management** - Zustand stores, hooks
4. **Utilities** - Helper functions, parsers

### Files to Exclude

Coverage excludes:
- Test files (`**/*.test.ts`)
- Type definitions (`**/*.d.ts`)
- Config files (`**/*.config.*`)
- Build artifacts (`dist/`, `node_modules/`)

## Viewing Coverage Details

### Per-File Coverage

Check individual file coverage in `coverage/index.html` or:

```bash
npx ts-node scripts/coverage-report.ts --verbose
```

This shows uncovered code paths:

```
--- Uncovered Code Paths (Top 20) ---
  [function] src/main/llm/openrouter.ts:line 145
         Function 'handleStreamError' is not covered
  [branch] src/main/voice/pipeline.ts:line 89
         if branch 2 is not covered
```

### Finding Low Coverage Files

The report highlights files needing attention:

```
--- Files Needing Attention (< 50% Coverage) ---
  src/main/tts/offline.ts: 42.5% (17/40 lines)
  src/main/voice/wake-word.ts: 38.2% (23/60 lines)
```

## Improving Coverage

### Strategy

1. **Start with unit tests** - Test individual functions/classes
2. **Add integration tests** - Test component interactions
3. **Mock external dependencies** - APIs, file system, audio devices
4. **Test error scenarios** - Network failures, invalid input

### Common Patterns

**Mocking Electron APIs:**
```typescript
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/path') },
  ipcMain: { handle: vi.fn() },
}));
```

**Testing async code:**
```typescript
it('should handle async operations', async () => {
  const result = await asyncOperation();
  expect(result).toBeDefined();
});
```

**Testing event emitters:**
```typescript
it('should emit events', (done) => {
  emitter.on('ready', () => done());
  emitter.initialize();
});
```

## Troubleshooting

### "Coverage data not found"

Run tests first:
```bash
npm run test:coverage
```

### "Threshold check failing"

Check which thresholds are failing:
```bash
npx ts-node scripts/coverage-report.ts --verbose
```

Then add tests for uncovered code paths.

### "Coverage seems inaccurate"

V8 coverage can be affected by:
- Dynamically generated code
- Eval statements
- Source maps issues

Try rebuilding:
```bash
npm run build
npm run test:coverage
```

## Configuration

### vitest.config.ts

```typescript
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 70,
      },
    },
  },
});
```

### Custom Thresholds

Override thresholds per-run:
```bash
npx ts-node scripts/coverage-report.ts \
  --threshold-lines 85 \
  --threshold-statements 85 \
  --threshold-functions 85 \
  --threshold-branches 75
```

## Resources

- [Vitest Coverage Documentation](https://vitest.dev/guide/coverage.html)
- [V8 Coverage](https://v8.dev/blog/javascript-code-coverage)
- [Testing Best Practices](https://testing-library.com/docs/guiding-principles)
