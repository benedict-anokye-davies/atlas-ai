# Atlas Desktop Bundle Analysis Report

**Generated:** (Run `npx ts-node scripts/analyze-bundle.ts --output markdown` to update)

## Overview

This document provides bundle size analysis for Atlas Desktop, including:

- Bundle sizes for main and renderer processes
- Dependency analysis and size estimates
- Tree-shaking opportunities
- Code splitting recommendations
- Native module sizes
- Size budgets and tracking

## Bundle Size Targets

| Bundle | Budget | Target |
|--------|--------|--------|
| Main Process | 5 MB | <3 MB ideal |
| Renderer | 3 MB | <2 MB ideal |
| Total | 10 MB | <6 MB ideal |
| Native Modules | - | Minimize |

## Current Bundle Sizes

### Build Outputs

| Bundle | Location | Content |
|--------|----------|---------|
| Main | `dist/main/` | Electron main process code |
| Renderer | `dist/renderer/` | React UI, Three.js orb |
| Preload | `dist/preload/` | IPC bridge scripts |

### Size Estimation

Run the analysis script to get current sizes:

```bash
npx ts-node scripts/analyze-bundle.ts --verbose
```

## Dependency Analysis

### Large Dependencies (>100KB estimated)

| Package | Est. Size | Context | Notes |
|---------|-----------|---------|-------|
| three | ~600 KB | Renderer | 3D visualization engine |
| @react-three/drei | ~200 KB | Renderer | R3F utilities |
| @react-three/fiber | ~150 KB | Renderer | React Three.js renderer |
| react-dom | ~120 KB | Renderer | React DOM rendering |
| @react-three/postprocessing | ~100 KB | Renderer | Visual effects |
| openai | ~80 KB | Both | LLM SDK |
| @deepgram/sdk | ~60 KB | Main | STT integration |
| winston | ~50 KB | Main | Logging |
| react | ~40 KB | Renderer | React core |
| electron-updater | ~40 KB | Main | Auto-updates |

### Native Modules (Not Bundled)

These modules are excluded from bundling and loaded at runtime:

| Module | Purpose | Notes |
|--------|---------|-------|
| @picovoice/porcupine-node | Wake word detection | Binary + WASM |
| @picovoice/pvrecorder-node | Audio recording | Native bindings |
| @ricky0123/vad-node | Voice activity detection | ONNX model |
| onnxruntime-node | ML inference | Native bindings |
| vosk-koffi | Offline STT | Native + model |
| koffi | FFI library | Native bindings |
| playwright | Browser automation | Heavy, ~100MB+ |

## Tree-Shaking Opportunities

### 1. Three.js Core

**Current:** Full three.js import
**Recommendation:** Import only needed exports

```typescript
// Before
import * as THREE from 'three';

// After
import { Scene, Vector3, Color, Points, BufferGeometry } from 'three';
```

**Potential Savings:** ~200KB if importing entire library unnecessarily

### 2. React Three Drei

**Current:** Multiple drei helpers imported
**Recommendation:** Audit imports, consider native Three.js for simple cases

```typescript
// Audit these imports
import { OrbitControls, Html, useTexture } from '@react-three/drei';

// Consider native alternatives for simple use cases
```

**Potential Savings:** ~50-100KB

### 3. OpenAI SDK

**Current:** Full SDK import
**Recommendation:** For simple chat completions, consider direct fetch

```typescript
// Alternative if only using chat completions
async function chat(messages: Message[]): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'gpt-4', messages }),
  });
  const data = await response.json();
  return data.choices[0].message.content;
}
```

**Potential Savings:** ~40KB

### 4. Winston Logger

**Current:** Full winston with transports
**Recommendation:** Consider lighter alternatives for renderer

```typescript
// For renderer, consider simple console wrapper
// Keep winston in main process only
```

**Potential Savings:** ~30KB in renderer

## Code Splitting Recommendations

### 1. Settings Component

**Reason:** Not needed on initial load
**Implementation:**

```typescript
const Settings = React.lazy(() => import('./components/Settings'));

// In App.tsx
<Suspense fallback={<LoadingIndicator />}>
  {showSettings && <Settings />}
</Suspense>
```

**Impact:** ~20KB off initial bundle

### 2. Onboarding Wizard

**Reason:** Only shown to new users
**Implementation:**

```typescript
const OnboardingWizard = React.lazy(() =>
  import('./components/onboarding/OnboardingWizard')
);
```

**Impact:** ~30KB off initial bundle

### 3. Debug Overlay

**Reason:** Development only
**Implementation:**

```typescript
// Only include in dev builds
const DebugOverlay = process.env.NODE_ENV === 'development'
  ? React.lazy(() => import('./components/DebugOverlay'))
  : () => null;
```

**Impact:** ~10KB in production

### 4. 3D Orb Visualization

**Reason:** Heavy Three.js dependency (~600KB)
**Implementation:**

```typescript
// Show simple CSS orb initially
const [orbLoaded, setOrbLoaded] = useState(false);
const AtlasOrb = React.lazy(() => import('./components/orb/AtlasOrb'));

// In render
{orbLoaded ? (
  <Suspense fallback={<CSSOrb />}>
    <AtlasOrb />
  </Suspense>
) : (
  <CSSOrb onVisible={() => setOrbLoaded(true)} />
)}
```

**Impact:** Faster initial render, defer ~600KB

### 5. Agent Tools (Main Process)

**Reason:** Tools have separate dependencies
**Implementation:**

```typescript
// Dynamically import tools when first needed
class ToolManager {
  private browserTool: BrowserTool | null = null;

  async getBrowserTool(): Promise<BrowserTool> {
    if (!this.browserTool) {
      const { BrowserTool } = await import('./tools/browser');
      this.browserTool = new BrowserTool();
    }
    return this.browserTool;
  }
}
```

**Impact:** Faster startup, load tools on demand

## Build Configuration

### Vite Configuration

The current `vite.config.ts` properly externalizes native modules:

```typescript
const nativeModules = [
  'electron',
  '@picovoice/porcupine-node',
  '@picovoice/pvrecorder-node',
  '@ricky0123/vad-node',
  'onnxruntime-node',
  'vosk-koffi',
  'koffi',
  'playwright',
];

// In rollupOptions
external: nativeModules,
```

### Recommended Additions

```typescript
// vite.config.ts additions for optimization
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'three-vendor': ['three'],
          'react-three': ['@react-three/fiber', '@react-three/drei'],
          'react-vendor': ['react', 'react-dom'],
        },
      },
    },
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
  },
});
```

## Size Tracking

### How to Track Size Over Time

The bundle analyzer tracks size history automatically:

```bash
# Run after each build/commit
npx ts-node scripts/analyze-bundle.ts

# View history
cat .bundle-reports/size-history.json
```

### CI Integration

Add to CI pipeline:

```yaml
# .github/workflows/bundle-check.yml
bundle-size:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
    - run: npm ci
    - run: npm run build:vite
    - run: npx ts-node scripts/analyze-bundle.ts --budget 10mb
    - name: Upload Report
      uses: actions/upload-artifact@v4
      with:
        name: bundle-report
        path: .bundle-reports/
```

### Budget Alerts

The script exits with code 1 if budgets are exceeded:

```bash
# Set custom budget
npx ts-node scripts/analyze-bundle.ts --budget 5mb

# CI will fail if total exceeds 10mb (2x main budget)
```

## Optimization Checklist

### Before Release

- [ ] Run bundle analysis: `npx ts-node scripts/analyze-bundle.ts --verbose`
- [ ] Check for budget violations
- [ ] Review large dependencies for alternatives
- [ ] Verify tree-shaking is working (check for unused exports)
- [ ] Confirm code splitting is functioning
- [ ] Test lazy-loaded components
- [ ] Compare size to previous release

### Quarterly Review

- [ ] Audit all dependencies for necessity
- [ ] Check for lighter alternatives to large packages
- [ ] Review native module sizes
- [ ] Update size budgets based on feature growth
- [ ] Analyze bundle composition changes

## Quick Commands

```bash
# Full analysis to console
npx ts-node scripts/analyze-bundle.ts --verbose

# Generate markdown report
npx ts-node scripts/analyze-bundle.ts --output markdown

# Generate all formats (console + json + markdown)
npx ts-node scripts/analyze-bundle.ts --output all

# Build and analyze
npx ts-node scripts/analyze-bundle.ts --build --verbose

# Check against custom budget
npx ts-node scripts/analyze-bundle.ts --budget 8mb

# View size history
cat .bundle-reports/size-history.json | jq '.[-5:]'
```

## Appendix: Size Reference

### Common Size Units

| Unit | Bytes |
|------|-------|
| 1 KB | 1,024 |
| 1 MB | 1,048,576 |
| 1 GB | 1,073,741,824 |

### Compression Ratios (Typical)

| Format | Ratio | Example (1MB source) |
|--------|-------|---------------------|
| Raw | 100% | 1,000 KB |
| Gzip | ~35% | 350 KB |
| Brotli | ~28% | 280 KB |

### Electron App Size Reference

| App | Size | Notes |
|-----|------|-------|
| Minimal Electron | ~150 MB | Electron runtime only |
| VS Code | ~350 MB | Heavy IDE |
| Slack | ~300 MB | Communication app |
| Discord | ~250 MB | Voice + gaming |
| **Atlas Target** | ~200 MB | Voice AI assistant |

---

*This report is auto-generated. Run `npx ts-node scripts/analyze-bundle.ts --output markdown` to update.*
